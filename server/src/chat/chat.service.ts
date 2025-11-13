import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { Model } from 'mongoose';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private prisma: PrismaService,
  ) {}

  async ensureMember(conversationId: string, userId: string) {
    try {
      const membership = await this.prisma.membership.findFirst({
        where: { conversationId, userId },
      });
      if (!membership)
        throw new BadRequestException('Not a member of conversation');
    } catch (error) {
      console.error('member ensure error', error);
      return;
    }
  }

  async createMessage(dto: CreateMessageDto) {
    if (!dto.conversationId || !dto.senderId)
      throw new BadRequestException('Invalid message payload');

    const createdMessage = await this.messageModel.create({
      conversationId: dto.conversationId,
      senderId: dto.senderId,
      type: dto.type,
      content: dto.content,
      attachments: dto.attachments || [],
      metadata: {},
      status: { deliveredTo: [], readBy: [] },
    });
    return createdMessage.toObject();
  }

  async getMessages(
    conversationId: string,
    limit = 50,
    before?: string,
  ): Promise<any[]> {
    const query = { conversationId };
    if (before)
      (query as { conversationId: string; _id: object })._id = { $lt: before };
    return this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async markDelivered(messageId: string, userId: string) {
    return this.messageModel.updateOne(
      { _id: messageId },
      { $addToSet: { 'status.deliveredTo': userId } },
    );
  }

  async markRead(messageId: string, userId: string) {
    return this.messageModel.updateOne(
      { _id: messageId },
      { $addToSet: { 'status.readBy': userId } },
    );
  }
}
