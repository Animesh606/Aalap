import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDTO, LoginDTO } from './dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDTO: RegisterDTO) {
    return await this.authService.register(registerDTO);
  }

  @Post('login')
  async login(@Body() loginDTO: LoginDTO) {
    return await this.authService.login(loginDTO);
  }
}
