import { Bot } from 'src/bot/entity/bot.entity';
import {
  Column,
  Entity,
  JoinColumn,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class Network {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  chainId: number;

  @Column()
  traderContractAddress: string;

  @Column()
  managerContractAddress: string;

  @Column('json', { nullable: true })
  RPC: string[];

  @Column({ nullable: true })
  symbol: string;

  @OneToMany(() => Bot, (bot) => bot.network)
  bots: Bot[];
}
