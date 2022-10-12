import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from 'src/auth/guard/api-key-auth.guard';
import { UserDto } from '../dto/user.dto';
import { UserService } from '../service/user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /*
  @UseGuards(ApiKeyAuthGuard)
  @Post('register')
  async register(@Body() userDto: UserDto) {
    return await this.userService.create(userDto);
  }
  */
}
