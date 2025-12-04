import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CallService {
  constructor(private prisma: PrismaService) {}

  async startCall(
    conversationId: string,
    hostId: string,
    participantIds: string[],
    metadata: Record<string, any> = {},
  ) {
    return this.prisma.call.create({
      data: {
        conversationId,
        hostId,
        participants: participantIds,
        metadata,
        startAt: new Date(),
      },
    });
  }

  async endCall(
    callId: string,
    endAt?: Date,
    metadata: Record<string, any> = {},
  ) {
    return this.prisma.call.update({
      where: { id: callId },
      data: { endAt: endAt ?? new Date(), metadata: { ...metadata } },
    });
  }

  async getCallsForConversation(conversationId: string, limit = 50) {
    return this.prisma.call.findMany({
      where: { conversationId },
      orderBy: { startAt: 'desc' },
      take: limit,
    });
  }

  async getCallById(callId: string) {
    return this.prisma.call.findUnique({ where: { id: callId } });
  }
}
