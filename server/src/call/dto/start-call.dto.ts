import { IsArray, IsOptional, IsString } from 'class-validator';

export class StartCallDTO {
  @IsString()
  conversationId: string;

  @IsString()
  hostId: string;

  @IsArray()
  participants: string[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
