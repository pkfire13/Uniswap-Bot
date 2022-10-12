import { PartialType } from '@nestjs/mapped-types';

export class UserDto {
  readonly username: string;
  readonly password: string;
}

export class UpdateUserDto extends PartialType(UserDto) {}
