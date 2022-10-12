import { ApiProperty } from '@nestjs/swagger';

export class CreateNetworkDto {
  @ApiProperty()
  readonly chainId: number;

  @ApiProperty()
  readonly traderContractAddress: string;

  @ApiProperty()
  readonly managerContractAddress: string;

  @ApiProperty({ type: [String] })
  readonly RPC: string[];

  @ApiProperty()
  readonly symbol: string;
}
