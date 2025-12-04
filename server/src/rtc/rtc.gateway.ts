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
import { NotificationService } from 'src/notification/notification.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CallService } from 'src/call/call.service';

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

export interface ReadMessagePayload {
  messageId: string;
  conversationId: string;
}

export interface TypingPayload {
  conversationId: string;
  isTyping: boolean;
}

export interface StartCallPayload {
  conversationId: string;
  partipants: string[];
  mode?: 'audio' | 'video';
}

export interface EndCallPayload {
  callId: string;
  conversationId?: string;
  metadata?: unknown;
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
    private notificationSvc: NotificationService,
    private prisma: PrismaService,
    private callSvc: CallService,
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
    try {
      await this.chatSvc.ensureMember(convId, userId);
    } catch (err) {
      client.emit('join_error', {
        conversationId: convId,
        message: (err as Error).message,
      });
      return;
    }
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
      // Check if user is member of the conversation
      await this.chatSvc.ensureMember(createDto.conversationId, userId);

      // Message save to database
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

      // Emit message to current conversation room
      this.server.to(saved.conversationId).emit('message', serverMessage);

      // Deliver all member of the conversation
      const memberships = await this.prisma.membership.findMany({
        where: { conversationId: saved.conversationId },
      });
      const memberIds = memberships.map((m) => m.userId);

      const deliveryList: string[] = [];
      const pushQueuedFor: string[] = [];

      for (const memberId of memberIds) {
        if (memberId === userId) continue;
        const sockets = await this.redisSvc.getUserSockets(memberId);
        if (sockets && sockets.length > 0) {
          // online user: direct send
          sockets.forEach((sid) =>
            this.server.to(sid).emit('message', serverMessage),
          );
          await this.chatSvc.markDelivered(serverMessage._id, memberId);
          deliveryList.push(memberId);
        } else {
          // offline user: enqueue pushjob
          await this.notificationSvc.enqueuePush({
            userId: memberId,
            title: 'New message',
            body: serverMessage.content
              ? serverMessage.content.slice(0, 140)
              : 'New message',
            data: {
              conversationId: serverMessage.conversationId,
              messageId: serverMessage._id,
            },
          });
          pushQueuedFor.push(memberId);
        }
      }

      // Send message_status back to sender
      const senderSockets = await this.redisSvc.getUserSockets(userId);
      const statusPayload = {
        messageId: serverMessage._id,
        deliveredTo: deliveryList,
        pushQueuedFor,
      };
      if (senderSockets && senderSockets.length > 0) {
        senderSockets.forEach((sid) => {
          this.server.to(sid).emit('message_status', statusPayload);
        });
      } else {
        client.emit('message_status', statusPayload);
      }
    } catch (error) {
      this.logger.error('Failed to persist message', error);
      client.emit('message_error', {
        tempId: payload.tempId ?? null,
        error: (error as Error).message || 'save_failed',
      });
    }
  }

  @SubscribeMessage('message_read')
  async onMessageRead(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: ReadMessagePayload,
  ) {
    const userId = client.data.userId;
    if (!payload || !payload.messageId || !payload.conversationId) {
      client.emit('message_error', { error: 'invalid_read_payload' });
      return;
    }

    try {
      // check if user is member of the conversation room
      await this.chatSvc.ensureMember(payload.conversationId, userId);

      // update to database
      await this.chatSvc.markRead(payload.messageId, userId);

      // broadcast event to the room
      this.server
        .to(payload.conversationId)
        .emit('message_read', { messageId: payload.messageId, userId });

      // notify the original sender
      const msg = await this.chatSvc.getMessageById(payload.messageId);
      if (msg && msg.senderId) {
        const senderSockets = await this.redisSvc.getUserSockets(msg.senderId);
        const statusPayload = {
          messageId: payload.messageId,
          readBy: [userId],
        };
        if (senderSockets && senderSockets.length > 0) {
          senderSockets.forEach((sid) =>
            this.server.to(sid).emit('message_status', statusPayload),
          );
        }
      }
    } catch (err) {
      client.emit('message_error', {
        error: (err as Error).message || 'read_failed',
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

  @SubscribeMessage('start_call')
  async onStartCall(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: StartCallPayload,
  ) {
    const userId = client.data.userId;
    try {
      // membership check
      await this.chatSvc.ensureMember(payload.conversationId, userId);

      // include host in participants
      const participants = Array.from(
        new Set([...(payload.partipants || []), userId]),
      );

      const call = await this.callSvc.startCall(
        payload.conversationId,
        userId,
        participants,
        { mode: payload.mode || 'audio' },
      );

      // notify partipants
      for (const pid of participants) {
        const sockets = await this.redisSvc.getUserSockets(pid);
        if (!sockets || sockets.length === 0) continue;
        sockets.forEach((sid) =>
          this.server.to(sid).emit('incoming_call', {
            callId: call.id,
            conversationId: payload.conversationId,
            hostId: userId,
            mode: payload.mode || 'audio',
          }),
        );
      }

      client.emit('call_started', { callId: call.id });
    } catch (error) {
      client.emit('call_error', {
        message: (error as Error).message || 'start_call_failed',
      });
    }
  }

  @SubscribeMessage('end_call')
  async onEndCall(
    @ConnectedSocket() client: ClientType,
    @MessageBody() payload: EndCallPayload,
  ) {
    const userId = client.data.userId;
    try {
      const updated = await this.callSvc.endCall(
        payload.callId,
        undefined,
        payload.metadata || {},
      );
      this.server
        .to(payload.conversationId || updated.conversationId)
        .emit('call_ended', { callId: payload.callId, endedBy: userId });
      client.emit('call_ended_ack', { callId: payload.callId });
    } catch (error) {
      client.emit('call_error', {
        message: (error as Error).message || 'end_call_failed',
      });
    }
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
