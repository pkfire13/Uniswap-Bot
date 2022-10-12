import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { BotModule } from './bot/bot.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule } from 'nest-winston';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { HistorianModule } from './historian/historian.module';
import { NetworkModule } from './network/network.module';
import * as winston from 'winston';
import path from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ expandVariables: true }),
    BotModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'devops',
      password: 'changeme',
      database: 'devops',
      autoLoadEntities: true,
      synchronize: true, //should be false in production system
    }),
    WinstonModule.forRoot({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          dirname: path.join(__dirname, '/../logs/'),
          filename: 'main.log',
          level: 'info',
        }),
      ],
    }),
    AuthModule,
    UserModule,
    HistorianModule,
    NetworkModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
