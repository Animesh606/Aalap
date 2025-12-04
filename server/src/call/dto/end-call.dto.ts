import { IsOptional, IsString } from 'class-validator';

export class EndCallDTO {
  @IsString()
  callId: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
