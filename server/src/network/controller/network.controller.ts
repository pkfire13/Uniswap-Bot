import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateNetworkDto } from '../dto/create-network.dto';
import { UpdateNetworkDto } from '../dto/update-network.dto';
import { NetworkService } from '../service/network.service';

@Controller('network')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  @Post()
  addNetwork(@Body() createNetworkDto: CreateNetworkDto) {
    return this.networkService.create(createNetworkDto);
  }

  @Patch(':id')
  updateNetwork(
    @Param('id') id: string,
    @Body() updateNetworkDto: UpdateNetworkDto,
  ) {
    return this.networkService.update(id, updateNetworkDto);
  }

  @Delete(':chainId')
  deleteNetwork(@Param('chainId') chainId: number) {
    return this.networkService.remove(chainId);
  }

  @Get('getNetwork/:chainId')
  getUUID(@Param('chainId') chainId: number) {
    return this.networkService.findByChainId(chainId);
  }
}
