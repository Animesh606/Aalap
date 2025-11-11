import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(
    username: string,
    password: string,
    email: string,
    displayName?: string,
  ) {
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash: hashedPassword,
        displayName,
      },
    });

    return user;
  }

  async getUserByEmailOrUsername(identifier: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
    });
    return user;
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    return user;
  }

  async getUserByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });
    return user;
  }

  async getUserByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    return user;
  }

  async isValidPassword(
    plainTextPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return await bcrypt.compare(plainTextPassword, hashedPassword);
  }
}
