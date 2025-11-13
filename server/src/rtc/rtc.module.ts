import { Module } from '@nestjs/common';
import { RtcGateway } from './rtc.gateway';
import { RedisSocketService } from './redis-socket.service';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [ChatModule],
  providers: [RtcGateway, RedisSocketService],
  exports: [RtcGateway, RedisSocketService],
})
export class RtcModule {}
