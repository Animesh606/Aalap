import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('conversations')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get(':id/messages')
  async list(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    return this.chatService.getMessages(id, lim, before);
  }
}
