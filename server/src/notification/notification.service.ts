import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

export interface PushJob {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt?: string;
}

@Injectable()
export class NotificationService implements OnModuleDestroy {
  client: RedisClientType;
  queueKey = 'push:queue';

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL });
    this.client.connect().catch((e) => {
      console.error('NotificationService Redis connect failed', e);
      process.exit(1);
    });
  }

  async enqueuePush(job: PushJob) {
    const payload = {
      ...job,
      createdAt: new Date().toISOString(),
    };
    await this.client.lPush(this.queueKey, JSON.stringify(payload));
    return payload;
  }

  async peekPending(n = 10) {
    const items = await this.client.lRange(this.queueKey, 0, n - 1);
    return items.map((s) => JSON.parse(s) as PushJob);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
