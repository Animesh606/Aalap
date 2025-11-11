import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDTO, LoginDTO } from './dto';
import { JwtService } from '@nestjs/jwt/dist/jwt.service';
import { UserService } from 'src/user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async register({ username, password, email }: RegisterDTO) {
    const [userByUsername, userByEmail] = await Promise.all([
      this.userService.getUserByUsername(username),
      this.userService.getUserByEmail(email),
    ]);

    if (userByUsername) throw new ConflictException('Username already taken');
    if (userByEmail) throw new ConflictException('Email already registered');

    const user = await this.userService.createUser(username, password, email);
    const token = this.createToken(user.id, user.username, user.email);
    return { message: 'User registered successfully', ...token };
  }

  async login({ username, password }: LoginDTO) {
    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException('Invalid username or password');

    const token = this.createToken(user.id, user.username, user.email);
    return { message: 'User logged in successfully', ...token };
  }

  async validateUser(username: string, password: string) {
    const user = await this.userService.getUserByEmailOrUsername(username);
    if (!user) return null;

    const isValid = await this.userService.isValidPassword(
      password,
      user.passwordHash,
    );
    if (!isValid) return null;

    return user;
  }

  createToken(userId: string, username: string, email: string) {
    const payload = { username: username, sub: userId };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: userId, username, email },
    };
  }
}
