import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BotService } from 'src/bot/service/bot.service';
import { Transaction } from 'src/historian/entity/transaction.entity';
import { NetworkService } from 'src/network/service/network.service';
import { getManager, Repository } from 'typeorm';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private networkService: NetworkService,
    private botService: BotService,
  ) {
    this.savePastEvents();
    this.startEventListening();
  }

  /**
   *
   * @param _Event
   * @param chainId
   * @param period needed due to differientating past and current events
   * @returns boolean of successful event saving
   */
  public async recordEvent(
    _Event: any,
    _BotStruct: any,
    _ManagerPrices: any,
    chainId: number,
    botId: number,
    period: number,
  ) {
    //prevent duplicates from being stored
    const event = await this.transactionRepository.findOne({
      transactionHash: _Event.transactionHash,
    });
    if (event) {
      return false;
    }

    //get timestamp from block number
    const block = await this.getBlockInfo(chainId, _Event.blockNumber);
    const unixTimestamp: any = block.timestamp;
    // console.log('botId', botId, 'depth', _BotStruct.currentDepth);

    const log = this.transactionRepository.create({
      timestamp: unixTimestamp,
      address: _Event.address,
      blockNumber: _Event.blockNumber,
      transactionHash: _Event.transactionHash,
      transactionIndex: _Event.transactionIndex,
      blockHash: _Event.blockHash,
      removed: _Event.removed,
      botId: botId,
      chainId: chainId,
      period: period,
      entryFunds: this.dividebyDecimal(_BotStruct.entryFunds, 6),
      currentDepth: _BotStruct.currentDepth,
      initPrice: this.dividebyDecimal(_BotStruct.initPrice, 6),
      STABLECOINBalance: this.dividebyDecimal(_BotStruct.STABLECOINBalance, 6),
      tokenBalance: this.dividebyDecimal(_BotStruct.tokenBalance, 18),
      gasBill: this.dividebyDecimal(_BotStruct.gasBill, 18),
      buyInPrice: this.dividebyDecimal(_ManagerPrices.buyInPrice, 6),
      sellOffPrice: this.dividebyDecimal(_ManagerPrices.sellOffPrice, 6),
    });
    return await this.transactionRepository.save(log);
  }

  private dividebyDecimal(num: number, decimals: number): number {
    if (decimals == 0) {
      return 0;
    }

    return num / Math.pow(10, decimals);
  }

  /**
   *
   * @param chainId
   * @returns int of latest block number stored in the DB
   */
  private async getLatestRepositoryBlockNumber(chainId: number) {
    const size = await this.transactionRepository.find();
    if (size.length >= 1) {
      //find the the blocknumber in the last entry
      const entityManager = getManager();
      const maxBlockNumber = await entityManager.query(
        `SELECT MAX("blockNumber") from transaction where "chainId" = ${chainId};`,
      );

      //if the there is no result from the WHERE clause, query will return null, therefore return 1
      if (maxBlockNumber[0].max === null) {
        return 1;
      }

      return maxBlockNumber[0].max;
    } else {
      return 1;
    }
  }

  /**
   * @description calls all events between n and latest block number and stores events into RDBMS
   * @returns
   */
  private async savePastEvents() {
    const networks = await this.networkService.getNetworks();

    for (let i = 0; i < networks.length; i++) {
      const chainId = networks[i].chainId;

      const contract = await this.networkService.getTraderContract(
        networks[i].chainId,
      );
      //determine from block
      //if db is empty: 1
      //if not empty: use the latest block number stored in the RDBMS
      const fromBlockNumber = await this.getLatestRepositoryBlockNumber(
        networks[i].chainId,
      );

      const botIds = await this.getBotIds(chainId);

      for (let k = 0; k < botIds.length; k++) {
        const option = {
          fromBlock: fromBlockNumber,
          filter: { botId: botIds[k] },
        };

        let events = [];
        try {
          events = await contract.getPastEvents('BotRunSuccess', option);
        } catch (error) {
          console.log('event error', error, 'botId', botIds[k]);
        }

        console.log(
          'adding total of ',
          events.length - 1,
          'events (chainId:',
          networks[i].chainId,
          '); blockNumber:',
          fromBlockNumber,
        );

        // add each event to RDBMS
        let periodCounter = await this.botService.getCurrentPeriod(
          chainId,
          botIds[k],
        );
        for (let j = 0; j < events.length; j++) {
          const botId = events[j].returnValues.botId;
          const blockNumber = events[j].blockNumber;

          // console.log('blockNumber', blockNumber);

          const botStruct = await this.getBotSnapshot(
            chainId,
            botId,
            blockNumber,
          );
          const depth = botStruct.currentDepth;
          const managerPrices = {
            buyInPrice: await this.getCurrentBuyInPrice(
              chainId,
              botId,
              depth,
              blockNumber,
            ),
            sellOffPrice: await this.getCurrentSellOffPrice(
              chainId,
              botId,
              depth,
              blockNumber,
            ),
          };

          //depth 0 == BotInitialized event
          if (depth == 0) {
            periodCounter++;
          }

          await this.recordEvent(
            events[j],
            botStruct,
            managerPrices,
            networks[i].chainId,
            botId,
            periodCounter,
          );
        }
        //update period
        await this.botService.updatePeriod(chainId, botIds[k], periodCounter);
      }
    }

    return true;
  }

  public async runSubscriptionSet(
    chainId: number,
    contract: Contract,
    web3: Web3,
  ) {
    this.initalizeSubscription(chainId, contract, web3, 'BotRunSuccess');
    this.initalizeSubscription(chainId, contract, web3, 'BotInitialized');
  }

  private async startEventListening() {
    //need web3 RPC from network
    const networks = await this.networkService.getNetworks();

    //for each network, start event subscription
    for (let i = 0; i < networks.length; i++) {
      const chainId = networks[i].chainId;
      const contract = await this.networkService.getTraderContract(chainId);

      const web3 = await this.networkService.getWeb3(chainId);

      this.runSubscriptionSet(chainId, contract, web3);
    }
  }

  public async initalizeSubscription(
    chainId: number,
    contract: Contract,
    web3: Web3,
    eventName: string,
  ) {
    const eventAbiItem = contract.options.jsonInterface.find(
      (a) => a.type === 'event' && eventName === a.name,
    );
    const eventSignature = (eventAbiItem as any).signature as string;
    const options = {
      // fromBlock: -1,
      address: contract.options.address,
      topics: [eventSignature],
    };

    try {
      if (eventName == 'BotRunSuccess') {
        web3.eth.subscribe('logs', options).on('data', async (log) => {
          //record and snapshot
          const botId = web3.utils.hexToNumber(log.topics[2]);
          const botStruct = await this.getBotSnapshot(chainId, botId);
          const period = await this.botService.getCurrentPeriod(chainId, botId);

          const managerPrices = await this.getManagerPrices(
            chainId,
            botId,
            botStruct.currentDepth,
          );

          this.recordEvent(
            log,
            botStruct,
            managerPrices,
            chainId,
            botId,
            period,
          );
          console.log('BotRunSuccess event');
        });
      } else {
        web3.eth.subscribe('logs', options).on('data', async (log) => {
          const botId = web3.utils.hexToNumber(log.topics[2]);
          const botStruct = await this.getBotSnapshot(chainId, botId);
          await this.botService.incrementPeriod(chainId, botId);
          const period = await this.botService.getCurrentPeriod(chainId, botId);

          const managerPrices = await this.getManagerPrices(
            chainId,
            botId,
            botStruct.currentDepth,
          );

          this.recordEvent(
            log,
            botStruct,
            managerPrices,
            chainId,
            botId,
            period,
          );
          console.log('Botinitalized event');
        });
      }
    } catch (error) {
      console.log('error in initalizing subscription', error);
    }
  }

  /**
   *
   * @param chainId
   * @param botId
   * @returns bot struct from DCA Trader contract
   */
  public async getBotSnapshot(
    chainId: number,
    botId: number,
    blockNumber?: number,
  ) {
    //
    const contract = await this.networkService.getTraderContract(chainId);
    const bot = await contract.methods.bots(botId).call(null, blockNumber);
    return bot;
  }
  /**
   *
   * @param chainId
   * @param botId
   * @param depth
   * @returns obj {buyInPrice: #, sellOffPrice: #}
   */
  private async getManagerPrices(
    chainId: number,
    botId: number,
    depth: number,
  ) {
    const _buyInPrice = await this.getCurrentBuyInPrice(chainId, botId, depth);
    const _sellOffPrice = await this.getCurrentSellOffPrice(
      chainId,
      botId,
      depth,
    );
    return { buyInPrice: _buyInPrice, sellOffPrice: _sellOffPrice };
  }
  /**
   *
   * @param chainId
   * @param botId
   * @param depth
   * @returns number
   */
  private async getCurrentBuyInPrice(
    chainId: number,
    botId: number,
    depth: number,
    blockNumber: number = null,
  ) {
    const bot = await this.getBotSnapshot(chainId, botId, blockNumber);

    const traderContract = await this.networkService.getTraderContract(chainId);
    const managerContract = await this.networkService.getManagerContract(
      chainId,
    );

    try {
      const buyAmounts = await traderContract.methods
        .getBotBuyAmounts(botId)
        .call();
      const tokenStrategyId = bot.tokenStrategyId;
      const inputAmount = buyAmounts[depth];

      const { output, price } = await managerContract.methods
        .getCurrentBuyInPrice(inputAmount, tokenStrategyId)
        .call(null, blockNumber, null);
      return price;
    } catch (error) {
      console.log('buyInPrice error', error);
      // t hrow new ConflictException(error);
    }
  }
  /**
   *
   * @param chainId
   * @param botId
   * @param depth
   * @returns number
   */
  private async getCurrentSellOffPrice(
    chainId: number,
    botId: number,
    depth: number,
    blockNumber: number = null,
  ) {
    const bot = await this.getBotSnapshot(chainId, botId, blockNumber);

    const managerContract = await this.networkService.getManagerContract(
      chainId,
    );

    try {
      const tokenStrategyId = bot.tokenStrategyId;
      // const inputAmount = sellThresholds[depth];
      const inputAmount = bot.tokenBalance;

      const { output, price } = await managerContract.methods
        .getCurrentSellOffPrice(inputAmount, tokenStrategyId)
        .call(null, blockNumber, null);
      return price;
    } catch (error) {
      console.log('sellOffPrice error', error);
      // throw new ConflictException(error);
    }
  }
  /**
   *
   * @param chainId
   * @param botId
   * @param period
   * @returns array of tx
   */
  public async findTransactions(
    chainId: number,
    botId: number,
    period?: number,
  ) {
    const transactions = await this.transactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.chainId = :chain_id', { chain_id: chainId })
      .andWhere('transaction.botId = :bot_id', { bot_id: botId })
      .andWhere('transaction.period = :_period', { _period: period })
      .orderBy('transaction.currentDepth')
      .getMany();
    return transactions;
  }

  /**
   * !!!! DEPRECIATED due to timestamp -> unix change
   * @param chainId
   * @param botId
   * @param start
   * @param end
   *
   * @returns array of tx
   */
  // public async getTransactionByTimeStamp(
  //   chainId: number,
  //   botId: number,
  //   start: string = '2000-12-12',
  //   end: string = 'NOW',
  // ) {
  //   try {
  //     const transactions = await this.transactionRepository
  //       .createQueryBuilder('transaction')
  //       .where('transaction.chainId = :chain_id', { chain_id: chainId })
  //       .andWhere('transaction.botId = :bot_id', { bot_id: botId })
  //       .andWhere('transaction.timestamp > :_start', {
  //         _start: start,
  //       })
  //       .andWhere('transaction.timestamp < :_end', { _end: end })
  //       .getMany();
  //     return transactions;
  //   } catch (error) {
  //     throw new ConflictException(error);
  //   }
  // }

  /**
   *
   * @param chainId
   * @param botId
   * @returns all transactions of the current period
   */
  public async getOpenPositions(chainId: number, botId: number) {
    const currrentPeriod = await this.botService.getCurrentPeriod(
      chainId,
      botId,
    );
    try {
      const transactions = await this.findTransactions(
        chainId,
        botId,
        currrentPeriod,
      );

      return transactions;
    } catch (error) {
      throw new ConflictException(error);
    }
  }
  /**
   *
   * @param chainId
   * @param botId
   * @returns tvl(stable coin balance + tokenBalance * price of the token) / entryFunds (1st period)
   */
  public async getTotalBotProfit(chainId: number, botId: number) {
    const bot = await this.getBotSnapshot(chainId, botId);
    const STABLECOINBalance = bot.STABLECOINBalance;
    const tokenBalance = bot.tokenBalance;
    const tokenPrice = await this.getCurrentSellOffPrice(
      chainId,
      botId,
      bot.currentDepth,
    );
    const tvl = STABLECOINBalance + tokenBalance * tokenPrice;

    const lowestPeriod = await this.getEarliestPeriod(chainId, botId);
    const tx = await this.findTransactions(chainId, botId, lowestPeriod);
    const entryFunds = tx[0].entryFunds;
    return tvl / entryFunds;
  }

  /**
   *
   * @param chainId
   * @param botId
   * @returns number
   */
  private async getEarliestPeriod(chainId: number, botId: number) {
    const entityManager = getManager();
    const lowestPeriodNumber = await entityManager.query(
      `SELECT MIN("period") from transaction where "chainId" = ${chainId} and "botId" = ${botId};`,
    );
    return lowestPeriodNumber[0].min;
  }

  public async getTVL(tx: any) {
    try {
      const STABLECOINBalance = tx.STABLECOINBalance;

      const tokenTVL = tx.tokenBalance * tx.sellOffPrice;
      const TVL = STABLECOINBalance + tokenTVL;
      return TVL;
    } catch (error) {
      throw new ConflictException(error);
    }
  }

  public async getPeriodTVL(chainId: number, botId: number, period: number) {
    const tx = await this.findTransactions(chainId, botId, period);
    return await this.getTVL(tx[tx.length - 1]);
  }

  public async getPeriodProfit(chainId: number, botId: number, period: number) {
    //entryFunds of depth 0 of period
    //tvl
    try {
      const tx = await this.findTransactions(chainId, botId, period);
      const entryFunds = tx[0].entryFunds;

      const TVL = await this.getTVL(tx[tx.length - 1]);

      return (TVL - entryFunds).toFixed(4);
    } catch (error) {
      throw new ConflictException(error);
    }
  }

  /**
   *
   * @param chainId
   * @param botId
   * @returns array of ints
   */
  public async getPeriods(chainId: number, botId: number) {
    const entityManager = getManager();
    const resp = await entityManager.query(
      `SELECT DISTINCT "period" from transaction where "chainId" = ${chainId} and "botId" = ${botId} ORDER BY "period" DESC;`,
    );

    let periods = [];
    for (let i = 0; i < resp.length; i++) {
      periods.push(resp[i].period);
    }

    //truncate arr to max 5 periods
    if (periods.length > 5) {
      periods = periods.slice(0, 5);
    }

    return periods;
  }

  /**
   *
   * @param chainId
   * @returns array (excluding 0 element)
   */
  public async getBotIds(chainId: number) {
    const traderContract = await this.networkService.getTraderContract(chainId);

    //exclusive
    const lastId: number = await traderContract.methods.getBotNextId().call();

    //exclude "0" element
    return Array.from({ length: lastId - 1 }, (_, index) => index + 1);
  }

  private async getBlockInfo(chainId: number, blockNumber: number) {
    const web3 = await this.networkService.getWeb3(chainId);
    return await web3.eth.getBlock(blockNumber);
  }

  public async getTimstamps(chainId: number, botId: number, period: number) {
    try {
      const tx = await this.findTransactions(chainId, botId, period);
      const nextPeriod = Number(period) + 1;
      const nextPeriodTx = await this.findTransactions(
        chainId,
        botId,
        nextPeriod,
      );

      const firstTxTS = new Date(tx[0].timestamp * 1000);
      let nextTxTS: any;
      if (nextPeriodTx.length == 0) {
        nextTxTS = new Date(tx[tx.length - 1].timestamp * 1000);
      } else {
        nextTxTS = new Date(nextPeriodTx[0].timestamp * 1000);
      }

      let _duration: any = this.getTimeDelta(firstTxTS, nextTxTS);
      _duration = this.msToTime(_duration);

      return { start: firstTxTS, end: nextTxTS, duration: _duration };
    } catch (e) {
      throw new ConflictException(e, 'period does not exist ');
    }
  }

  private getTimeDelta(t1: any, t2: any) {
    return Math.abs(t1 - t2);
  }

  private msToTime(ms: number) {
    let seconds: any = (ms / 1000).toFixed(1);
    let minutes: any = (ms / (1000 * 60)).toFixed(1);
    let hours: any = (ms / (1000 * 60 * 60)).toFixed(1);
    let days: any = (ms / (1000 * 60 * 60 * 24)).toFixed(1);

    if (seconds < 60) return seconds + ' Sec';
    else if (minutes < 60) return minutes + ' Min';
    else if (hours < 24) return hours + ' Hrs';
    else return days + ' Days';
  }
}
