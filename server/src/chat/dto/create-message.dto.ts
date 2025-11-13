import { IsArray, IsOptional, IsString } from 'class-validator';
import { Attachment, MessageType } from '../schemas/message.schema';

export class CreateMessageDto {
  @IsString()
  conversationId: string;

  @IsString()
  senderId: string;

  @IsString()
  type: MessageType;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  attachments?: Attachment[];

  @IsOptional()
  @IsString()
  tempId?: string;
}
