import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { NetworkModule } from 'src/network/network.module';
import { BotController } from './controller/bot.controller';
import { Bot } from './entity/bot.entity';
import { BotService } from './service/bot.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bot]),
    AuthModule,
    ConfigModule.forRoot(),
    NetworkModule,
  ],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
