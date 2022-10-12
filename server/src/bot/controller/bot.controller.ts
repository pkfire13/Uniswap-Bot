import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Patch,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { AuthService } from 'src/auth/service/auth.service';
import { CreateBotDto } from '../dto/create-bot.dto';
import { UpdateBotDto } from '../dto/update-bot.dto';
import { BotService } from '../service/bot.service';

@Controller('bot')
export class BotController {
  constructor(
    private readonly botService: BotService,
    private authService: AuthService,
  ) {}

  @Post()
  create(@Body() createBotDto: CreateBotDto) {
    return this.botService.create(createBotDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateBotDto: UpdateBotDto) {
    return this.botService.update(id, updateBotDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.botService.remove(id);
  }

  //@UseGuards(JwtAuthGuard)
  @Post('startbot/:chainId/:botId')
  startBot(@Param('chainId') chainId: number, @Param('botId') botId: number) {
    return this.botService.start(chainId, botId);
  }

  //@UseGuards(JwtAuthGuard)
  @Post('stopbot/:chainId/:botId')
  stopBot(@Param('chainId') chainId: number, @Param('botId') botId: number) {
    return this.botService.stop(chainId, botId);
  }

  //@UseGuards(JwtAuthGuard)
  @Get('isRunning/:chainId/:botId')
  isRunning(@Param('chainId') chainId: number, @Param('botId') botId: number) {
    return this.botService.isRunning(chainId, botId);
  }

  @Get('getUUID/:chainId/:botId')
  getUUID(@Param('chainId') chainId: number, @Param('botId') botId: number) {
    return this.botService.getUUIDByChainIdAndBotId(chainId, botId);
  }

  @Get('forceAttemptRun/:chainId/:botId')
  forceAttemptRun(
    @Param('chainId') chainId: number,
    @Param('botId') botId: number,
  ) {
    return this.botService.forceAttemptRun(chainId, botId);
  }
}
