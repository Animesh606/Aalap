import { Module } from '@nestjs/common';
import { RtcGateway } from './rtc.gateway';
import { RedisSocketService } from './redis-socket.service';

@Module({
  providers: [RtcGateway, RedisSocketService],
  exports: [RtcGateway, RedisSocketService],
})
export class RtcModule {}
