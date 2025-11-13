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

export interface JoinPayload {
  conversationId: string;
}

export type MessageType = 'text' | 'image' | 'system' | 'reaction';

export interface Attachment {
  url: string;
  type?: string;
  size?: number;
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
  ) {}

  async handleConnection(client: Socket) {
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
      (client.data as { userId: string }).userId = payload.sub;

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

  async handleDisconnect(client: Socket) {
    try {
      const sid = client.id;
      const userId =
        (client.data as { userId?: string }).userId ||
        (await this.redisSvc.getSocketUser(sid));

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
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ) {
    const convId = payload.conversationId;
    // TODO: verify membership via prisma
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
  onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: SendMessagePayload,
  ) {
    const userId = (client.data as { userId: string }).userId;
    const serverMessage = {
      _id: `srv_${Date.now()}`, // change to mongo id
      conversationId: payload.conversationId,
      senderId: userId,
      type: payload.type || 'text',
      content: payload.content || '',
      attachments: payload.attachments || [],
      createdAt: new Date().toISOString(),
      tempId: payload.tempId ?? null,
    };
    this.server.to(payload.conversationId).emit('message', serverMessage);
    // TODO: DB Sync
  }

  @SubscribeMessage('typing')
  onTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TypingPayload,
  ) {
    const userId = (client.data as { userId: string }).userId;
    client.to(payload.conversationId).emit('typing', {
      conversationId: payload.conversationId,
      userId,
      isTyping: payload.isTyping,
    });
  }

  @SubscribeMessage('rtc_offer')
  async onOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RtcOfferPayload,
  ) {
    await this.forwardToUser(payload.to, 'rtc_offer', {
      from: (client.data as { userId: string }).userId,
      sdp: payload.sdp,
    });
  }

  @SubscribeMessage('rtc_ice')
  async onIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RtcIcePayload,
  ) {
    await this.forwardToUser(payload.to, 'rtc_ice', {
      from: (client.data as { userId: string }).userId,
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
