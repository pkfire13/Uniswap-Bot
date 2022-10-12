import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { TransactionService } from 'src/historian/service/transaction.service';

@Controller('transaction')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Get('/')
  async find(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
    @Query('period') period?: number,
  ) {
    return await this.transactionService.findTransactions(
      chainId,
      botId,
      period,
    );
  }

  //   @ApiQuery({
  //     name: 'start',
  //     required: false,
  //     example: '2020-01-01, 2022-07-05T18:32:24.716Z, NOW',
  //   })
  //   @ApiQuery({ name: 'end', required: false })
  //   @Get('/byTimeInterval')
  //   async findbyTimeInterval(
  //     @Query('chainId') chainId: number,
  //     @Query('botId') botId: number,
  //     @Query('start') start: string,
  //     @Query('end') end: string,
  //   ) {
  //     return await this.transactionService.getTransactionByTimeStamp(
  //       chainId,
  //       botId,
  //       start,
  //       end,
  //     );
  //   }

  @Get('/totalBotProfit')
  async getBotProfit(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
  ) {
    return await this.transactionService.getTotalBotProfit(chainId, botId);
  }

  @Get('getPeriodTVL')
  async getTVL(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
    @Query('period') period: number,
  ) {
    return await this.transactionService.getPeriodTVL(chainId, botId, period);
  }

  @Get('/periodProfit')
  async getPeriodProfit(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
    @Query('period') period: number,
  ) {
    return await this.transactionService.getPeriodProfit(
      chainId,
      botId,
      period,
    );
  }

  @Get('periods')
  async getPeriods(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
  ) {
    return await this.transactionService.getPeriods(chainId, botId);
  }

  @Get('timestamps')
  async getTimestamps(
    @Query('chainId') chainId: number,
    @Query('botId') botId: number,
    @Query('period') period: number,
  ) {
    return await this.transactionService.getTimstamps(chainId, botId, period);
  }
}
