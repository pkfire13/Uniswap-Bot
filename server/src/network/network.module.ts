import { Module } from '@nestjs/common';
import { TypeOrmModule } from "@nestjs/typeorm";
import { NetworkController } from "./controller/network.controller";
import { Network } from "./entity/network.entity";
import { NetworkService } from "./service/network.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([Network])
    ],
  controllers: [NetworkController],
  providers: [NetworkService],
  exports: [NetworkService]
})
export class NetworkModule {}
