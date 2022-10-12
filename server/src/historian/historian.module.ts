import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotModule } from 'src/bot/bot.module';
import { NetworkModule } from 'src/network/network.module';
import { Transaction } from './entity/transaction.entity';
import { TransactionService } from './service/transaction.service';
import { TransactionController } from './controller/transaction/transaction.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), NetworkModule, BotModule],
  providers: [TransactionService],
  exports: [TransactionService],
  controllers: [TransactionController],
})
export class HistorianModule {}
