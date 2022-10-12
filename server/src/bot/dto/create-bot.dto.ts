export class CreateBotDto {
  readonly contractBotId: number;
  readonly chainId: number;
  readonly isRunning: boolean;
  readonly enableRestart: boolean;
  readonly isLocked: boolean;
  readonly currentPeriod: number;
}
