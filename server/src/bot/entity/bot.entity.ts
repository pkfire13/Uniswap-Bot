import { Network } from 'src/network/entity/network.entity';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class Bot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  contractBotId: number;

  @Column()
  chainId: number;

  @Column({ default: false })
  isRunning: boolean;

  @Column({ default: true })
  enableRestart: boolean;

  @Column({ default: false })
  isLocked: boolean;

  @Column({ default: 0 })
  currentPeriod: number;

  @ManyToOne(() => Network, (network) => network.bots)
  @JoinColumn()
  network: Network;
}
