import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export class Attachment {
  url: string;
  type?: string;
  size?: number;
}

export class MessageStatus {
  deliveredTo: string[];
  readBy: string;
}

export enum MessageType {
  text = 'text',
  image = 'image',
  system = 'system',
  reaction = 'reaction',
}

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: String, required: true })
  conversationId: string;

  @Prop({ type: String, required: true })
  senderId: string;

  @Prop({ required: true, enum: MessageType, default: MessageType.text })
  type: MessageType;

  @Prop({ type: String })
  content?: string;

  @Prop({ type: Array<Attachment>, default: [] })
  attachments?: Attachment[];

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, unknown>;

  @Prop({ type: MessageStatus, default: { deliveredTo: [], readBy: [] } })
  status?: MessageStatus;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
