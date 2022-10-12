import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDto } from '../dto/user.dto';
import { User } from '../entity/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRespository: Repository<User>,
  ) {}

  //async findOne(username: string): Promise<User | undefined> {
  //return this.users.find((user) => user.username === username);
  //}

  public async findByUsername(username: string): Promise<User> {
    const user = await this.userRespository.findOne({ username });

    if (!user) {
      throw new NotFoundException('Unknown user');
    }
    return user;
  }

  public async create(createUser: UserDto) {
    const user = this.userRespository.create({
      username: createUser.username,
      password: createUser.password,
    });
    return await this.userRespository.save(user);
  }
}
