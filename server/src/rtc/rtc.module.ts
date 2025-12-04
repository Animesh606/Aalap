import { Module } from '@nestjs/common';
import { RtcGateway } from './rtc.gateway';
import { RedisSocketService } from './redis-socket.service';
import { ChatModule } from 'src/chat/chat.module';
import { NotificationModule } from 'src/notification/notification.module';
import { CallModule } from 'src/call/call.module';

@Module({
  imports: [ChatModule, NotificationModule, CallModule],
  providers: [RtcGateway, RedisSocketService],
  exports: [RtcGateway, RedisSocketService],
})
export class RtcModule {}
