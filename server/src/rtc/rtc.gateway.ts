import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RedisSocketService } from './redis-socket.service';
import { ChatService } from 'src/chat/chat.service';
import { CreateMessageDto } from 'src/chat/dto/create-message.dto';
import { Attachment, MessageType } from 'src/chat/schemas/message.schema';

export interface JoinPayload {
  conversationId: string;
}

export interface ClientType extends Socket {
  data: {
    userId: string;
  };
}

export interface SendMessagePayload {
  conversationId: string;
  tempId?: string | null;
  type: MessageType;
  content?: string;
  attachments?: Attachment[];
}

export interface TypingPayload {
  conversationId: string;
  isTyping: boolean;
}

export interface RtcOfferPayload {
  to: string;
  sdp: unknown;
}

export interface RtcIcePayload {
  to: string;
  candidate: unknown;
}

export interface ServerMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content?: string;
  attachments?: Attachment[];
  createdAt: string;
  tempId?: string | null;
  metadata?: Record<string, unknown>;
}

@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: '*' },
})
@Injectable()
export class RtcGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(RtcGateway.name);

  constructor(
    private jwt: JwtService,
    private redisSvc: RedisSocketService,
    private chatSvc: ChatService,
  ) {}

  async handleConnection(client: ClientType) {
    try {
      const token =
        (client.handshake.auth && (client.handshake.auth.token as string)) ||
        (client.handshake.query && (client.handshake.query.token as string));

      if (!token) {
        this.logger.warn(
          'Socket connection without token, disconnecting',
          client.id,
        );
        client.disconnect();
        return;
      }

      const payload = this.jwt.verify<{ sub: string; username: string }>(
        token,
        {
          secret: process.env.JWT_SECRET,
        },
      );
      client.data.userId = payload.sub;

      await this.redisSvc.addSocket(payload.sub, client.id);
      await this.redisSvc.setPresence(payload.sub, 'online');

      this.server.emit('presence_update', {
        userId: payload.sub,
        status: 'online',
      });

      this.logger.log(`Client connected ${client.id} user ${payload.sub}`);
    } catch (err) {
      this.logger.warn('Socket auth failed', (err as Error).message || err);
      client.emit('auth_error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: ClientType) {
    try {
      const sid = client.id;
      const userId =
        client.data.userId || (await this.redisSvc.getSocketUser(sid));

      if (userId) {
        await this.redisSvc.removeSocket(sid);
        const remaining = await this.redisSvc.getUserSockets(userId);
        if (!remaining || remaining.length == 0) {
          await this.redisSvc.setPresence(userId, 'offline');
          this.server.emit('presence_update', { userId, status: 'offline' });
        }
      }
      this.logger.log(`Clinet disconnected ${client.id}`);
    } catch (error) {
      this.logger.error('Error during disconnect', error);
    }
  }

  @SubscribeMessage('join_conversation')
  async onJoin(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: JoinPayload,
  ) {
    const convId = payload.conversationId;
    const userId = client.data.userId;
    await this.chatSvc.ensureMember(convId, userId).catch(() => null);
    await client.join(convId);
    client.emit('joined', { conversationId: convId });
  }

  @SubscribeMessage('leave_conversation')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ) {
    await client.leave(payload.conversationId);
    client.emit('left', { conversationId: payload.conversationId });
  }

  @SubscribeMessage('send_message')
  async onMessage(
    @ConnectedSocket() client: ClientType,
    @MessageBody()
    payload: SendMessagePayload,
  ) {
    const userId = client.data.userId;

    const createDto: CreateMessageDto = {
      conversationId: payload.conversationId,
      type: payload.type,
      content: payload.content,
      attachments: payload.attachments,
      tempId: payload.tempId ?? undefined,
      senderId: userId,
    };

    try {
      await this.chatSvc
        .ensureMember(createDto.conversationId, userId)
        .catch(() => null);

      const saved = await this.chatSvc.createMessage(createDto);
      const serverMessage: ServerMessage = {
        _id: saved._id.toString(),
        conversationId: saved.conversationId,
        senderId: saved.senderId,
        type: saved.type,
        content: saved.content,
        attachments: saved.attachments || [],
        createdAt: (
          saved as typeof saved & { createdAt: Date }
        ).createdAt.toISOString(),
        tempId: createDto.tempId ?? null,
        metadata: saved.metadata ?? {},
      };

      this.server.to(saved.conversationId).emit('message', serverMessage);

      // TODO: for each user in conversation update delivery status
    } catch (error) {
      this.logger.error('Failed to persist message', error);
      client.emit('message_error', {
        tempId: payload.tempId ?? null,
        error: (error as Error).message || 'save_failed',
      });
    }
  }

  @SubscribeMessage('typing')
  onTyping(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: TypingPayload,
  ) {
    const userId = client.data.userId;
    client.to(payload.conversationId).emit('typing', {
      conversationId: payload.conversationId,
      userId,
      isTyping: payload.isTyping,
    });
  }

  @SubscribeMessage('rtc_offer')
  async onOffer(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: RtcOfferPayload,
  ) {
    await this.forwardToUser(payload.to, 'rtc_offer', {
      from: client.data.userId,
      sdp: payload.sdp,
    });
  }

  @SubscribeMessage('rtc_answer')
  async onAnswer(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: RtcOfferPayload,
  ) {
    await this.forwardToUser(payload.to, 'rtc_answer', {
      from: client.data.userId,
      sdp: payload.sdp,
    });
  }

  @SubscribeMessage('rtc_ice')
  async onIce(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: RtcIcePayload,
  ) {
    await this.forwardToUser(payload.to, 'rtc_ice', {
      from: client.data.userId,
      candidate: payload.candidate,
    });
  }

  private async forwardToUser(userId: string, event: string, payload: unknown) {
    const socket = await this.redisSvc.getUserSockets(userId);
    if (!socket || socket.length == 0) return;
    socket.forEach((sid) => {
      this.server.to(sid).emit(event, payload);
    });
  }
}
