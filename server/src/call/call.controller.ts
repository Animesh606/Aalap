import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CallService } from './call.service';
import { StartCallDTO, EndCallDTO } from './dto';

@Controller('calls')
export class CallController {
  constructor(private svc: CallService) {}

  @Post('start')
  async start(@Body() dto: StartCallDTO) {
    return this.svc.startCall(
      dto.conversationId,
      dto.hostId,
      dto.participants,
      dto.metadata,
    );
  }

  @Post('end')
  async end(@Body() dto: EndCallDTO) {
    return this.svc.endCall(dto.callId, undefined, dto.metadata || {});
  }

  @Get('conversation/:id')
  async list(@Param() id: string, @Query() limit?: string) {
    return this.svc.getCallsForConversation(
      id,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  async get(@Param() id: string) {
    return this.svc.getCallById(id);
  }
}
