import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
} from 'class-validator';

export class RegisterDTO {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsEmail()
  email: string;
}
