import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisSocketService implements OnModuleDestroy {
  client: RedisClientType;

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL });
    this.client.connect().catch((e) => {
      console.error('Redis client error: ', e);
      process.exit(1);
    });
  }

  async addSocket(userId: string, socketId: string) {
    await this.client.sAdd(`userSockets:${userId}`, socketId);
    await this.client.set(`socketUser:${socketId}`, userId);
  }

  async removeSocket(socketId: string) {
    const userId = await this.client.get(`socketUser:${socketId}`);
    if (!userId) return;
    await this.client.sRem(`userSocket:${userId}`, socketId);
    await this.client.del(`socketUser:${socketId}`);
  }

  async getUserSockets(userId: string): Promise<string[]> {
    const members = await this.client.sMembers(`userSockets:${userId}`);
    return members || [];
  }

  async getSocketUser(socketId: string) {
    return await this.client.get(`socketUser:${socketId}`);
  }

  async setPresence(userId: string, status: 'online' | 'offline') {
    await this.client.hSet(`presence:${userId}`, {
      status,
      lastUpdated: Date.now().toString(),
    });
  }

  async getPresence(userId: string) {
    await this.client.hGetAll(`presence:${userId}`);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
