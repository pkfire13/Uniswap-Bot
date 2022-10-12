import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @Column({ type: 'bigint' })
  timestamp: number;

  //Event
  @Column()
  address: string;

  @Column({ type: 'bigint' })
  blockNumber: number;

  @Column()
  transactionHash: string;

  @Column()
  transactionIndex: number;

  @Column()
  blockHash: string;

  @Column({ nullable: true })
  removed: boolean;

  //misc
  @Column({ nullable: false })
  botId: number;

  @Column({ nullable: false })
  chainId: number;

  @Column({ nullable: true })
  period: number;

  //bot Struct
  //div by 1e6
  @Column({ nullable: true, type: 'float8' })
  entryFunds: number;

  @Column({ nullable: true })
  currentDepth: number;

  //div by 1e6
  @Column({ nullable: true, type: 'float8' })
  initPrice: number;

  //div by 1e6
  @Column({ nullable: true, type: 'float8' })
  STABLECOINBalance: number;

  //div by 1e18
  @Column({ nullable: true, type: 'float8' })
  tokenBalance: number;

  //div by 1e18
  @Column({ nullable: true, type: 'float8' })
  gasBill: number;

  //manager prices
  //div by 1e6
  @Column({ nullable: true, type: 'float8' })
  buyInPrice: number;

  //div by 1e6
  @Column({ nullable: true, type: 'float8' })
  sellOffPrice: number;
}
