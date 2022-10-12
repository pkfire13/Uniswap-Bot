import {
  Injectable,
  NotFoundException,
  Inject,
  PreconditionFailedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bot } from '../entity/bot.entity';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { UpdateBotDto } from '../dto/update-bot.dto';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'winston';
import { CreateBotDto } from '../dto/create-bot.dto';
import { NetworkService } from 'src/network/service/network.service';

@Injectable()
export class BotService {
  private subscriptions = new Map<string, any>();
  private BOT_WALLET_ADDRESS: string =
    this.configService.get<string>('BOT_WALLET_ADDRESS');

  private BOT_WALLET_PRIVATE_ADDRESS: string = this.configService.get<string>(
    'BOT_WALLET_PRIVATE_ADDRESS',
  );

  constructor(
    @InjectRepository(Bot)
    private readonly botRepository: Repository<Bot>,
    private configService: ConfigService,
    private networkService: NetworkService,
    @Inject('winston')
    private readonly logger: Logger,
  ) {
    this.rebootBots();
  }

  async rebootBots() {
    const bots = await this.botRepository.find();

    this.logger.info('Rebooting bots');
    console.log('bots:', bots);

    for (let i = 0; i < bots.length; i++) {
      //update all isLocked to false
      await this.unlockBot(bots[i].id);
      //TODO: start bot by condition: EnableRestart == true
      if (bots[i].enableRestart == true) {
        await this.start(bots[i].chainId, bots[i].contractBotId);
      }
    }

    return `this should restart all the bots in the repository`;
  }

  public async create(createBotDto: CreateBotDto) {
    const { chainId, contractBotId } = createBotDto;

    // validate network (has network been created?); implicit within findByChainId
    const network = await this.networkService.findByChainId(chainId);

    // make sure this contractBotId hasnt been created already with this chainId
    const created = await this.botCreated(chainId, contractBotId);
    if (created === true) {
      throw new PreconditionFailedException('bot already created');
    }

    const bot = this.botRepository.create({
      ...createBotDto,
      network: network,
    });

    return await this.botRepository.save(bot);
  }

  /**
   *
   * @dev updates the bot with the given uuid by overwritting the bot table with new data object
   *
   * @param id uuid
   * @param updateBotDto data type object for the new bot
   *
   */
  public async update(id: string, updateBotDto: UpdateBotDto) {
    return await this.botRepository.update(id, updateBotDto);
  }

  /**
   *
   * @param id uuid reference for the bot within the bot table
   *
   */
  public async remove(id: string) {
    const bot = await this.findByUUID(id);

    // subscription will cause runtime errors if bot object is removed from RDBMS without stopping subscription
    if (bot.isRunning === true) {
      throw new ConflictException(
        `Bot ${id} is currently running and therefore cannot be deleted. Please stop bot subscription before removal`,
      );
    }
    return await this.botRepository.remove(bot);
  }

  /**
   *
   * @param id
   * @returns
   *
   */
  private async findByUUID(id: string) {
    const bot = await this.botRepository.findOne({ id: id });

    if (!bot) {
      throw new NotFoundException('Unknown bot');
    }
    return bot;
  }

  /**
   *
   * @param chainId
   * @param botId
   * @returns
   */
  private async findByChainIdAndBotId(chainId: number, botId: number) {
    const bot = await this.botRepository.findOne({
      contractBotId: botId,
      chainId: chainId,
    });

    if (!bot) {
      throw new NotFoundException('Unknown bot');
    }

    return bot;
  }

  /**
   *
   * @param chainId the network Id
   * @param botId the onchain smart contract ledger Id that governs this bot
   *
   * @returns botUUID the string for the bot so that the application layer
   * can use endpoints based on the uuid
   *
   */
  public async getUUIDByChainIdAndBotId(chainId: number, botId: number) {
    const bot = await this.findByChainIdAndBotId(chainId, botId);
    return bot.id;
  }

  /**
   *
   * @dev method for determmining if this bot has been created or not
   *
   * @param chainId
   * @param botId
   *
   * @returns bool
   *
   */
  private async botCreated(chainId: number, botId: number) {
    const bot = await this.botRepository.findOne({
      contractBotId: botId,
      chainId: chainId,
    });
    if (!bot) {
      return false;
    } else {
      return true;
    }
  }

  async start(chainId: number, botId: number) {
    // get the bot
    let bot = null;
    if ((await this.botCreated(chainId, botId)) === false) {
      const createBotDto: CreateBotDto = {
        contractBotId: botId,
        chainId: chainId,
        isRunning: true,
        enableRestart: true,
        isLocked: false,
        currentPeriod: 0,
      };
      bot = await this.create(createBotDto);
    } else {
      bot = await this.findByChainIdAndBotId(chainId, botId);
    }

    // get the contract from the network service
    const contract = await this.networkService.getTraderContract(chainId);

    const within = parseInt(await contract.methods.getBotNextId().call());
    if (botId > within) {
      return `invalid #${botId}`;
    }

    this.startSubscription(bot.id);

    await this.update(bot.id, { isRunning: true });

    return `this should start bot #${botId} on chainId ${chainId}`;
  }

  async stop(chainId: number, botId: number) {
    const bot = await this.findByChainIdAndBotId(chainId, botId);
    const successful = this._stopSubscription(bot.id);
    if (successful === false) {
      throw new ConflictException(
        `Cound not stop subscription of bot ${botId}`,
      );
    }
    this.update(bot.id, { isRunning: false, enableRestart: false }); //update isrunning
    return `this should stop bot #${bot.id}`;
  }

  /**
   *
   * @notice apologies for the informalities within the documentation
   *
   */
  private async startSubscription(botUUID: string) {
    //obtain the bot
    const bot = await this.findByUUID(botUUID);

    //get the bot chainId
    const { chainId } = bot;

    // log
    this.logger.info(`Starting Subscription for ${botUUID}`);

    // get the contract from the network service
    const contract = await this.networkService.getTraderContract(chainId);

    const subInstance = setInterval(async () => {
      const lockstate = await this.getLockState(botUUID);

      if (lockstate === false) {
        // lock the bot here
        await this.lockBot(botUUID);

        // obtain the truth
        const the_truth = await this.checkRunningConditions(
          bot.contractBotId,
          contract,
          chainId,
        );

        // if there is a running conddition then run
        if (the_truth === true) {
          // run that shit
          const web3 = await this.networkService.getWeb3(chainId);
          this.attemptRun(chainId, bot.contractBotId, web3, contract);
        }

        // unlock here
        await this.unlockBot(botUUID);
      } else {
        return;
      }
    }, parseInt(this.configService.get<string>('GLOBAL_CHECK_DELAY')));

    return this.subscriptions.set(botUUID, subInstance);
  }

  /**
   *
   * @param id botUUID
   * @returns true if successful, false if not
   * @notice setInterval can be stopped by passing the object into clearInterval function
   *
   */
  private _stopSubscription(id: string) {
    const subInstance = this.subscriptions.get(id);

    clearInterval(subInstance);

    return this.subscriptions.delete(id);
  }

  /**
   *
   * @param id the id of the bot
   * @param contract the contract object used for sending direct queries through
   *
   * @returns bool: the running condition of the bot
   *
   */
  private async checkRunningConditions(
    contractBotId: number,
    contract: Contract,
    chainId: number,
  ) {
    let isFulfillable = false;
    let isDestroyed = false;

    try {
      const botInfo = await contract.methods.bots(contractBotId).call();
      isDestroyed = botInfo.destroyed;
      if (isDestroyed === false) {
        try {
          isFulfillable = await contract.methods
            .isFulfillable(contractBotId)
            .call();
        } catch {
          console.log(
            'isFulfillable caught on bot id',
            contractBotId,
            'this is most likely due to a radical price drop',
          );
        }
      } else {
        // we need a catch to stop the subscription here,
        //although doing it in a nested way like this will only
        // cause errors since the subscription id isnt saved by the time this logic runs
        this.logger.info(
          `Stopping bot ${contractBotId} on chainId ${chainId} due to isDestroyed running condition`,
        );
      }
    } catch (error) {
      // console.log('BOT ID ', id, '\nERROR: ', error);
    }
    console.log(
      'Running Condition(s) for bot ',
      contractBotId,
      isFulfillable,
      isDestroyed,
    );
    return isFulfillable && !isDestroyed;
  }

  /*
   *
   * @notice:
   * 1. check contract's method "isFufillable"
   * 2. if true: send signedTransaction to contract's method "run(id)"
   * 3. else: resume without transaction
   *
   */
  private async attemptRun(
    chainId: number,
    contractBotId: number,
    web3: Web3,
    contract: Contract,
  ) {
    try {
      const tx = contract.methods.run(contractBotId);
      const gas = (await tx.estimateGas({ from: this.BOT_WALLET_ADDRESS })) * 2;
      let gasPrice = await web3.eth.getGasPrice();
      console.log('original gas price', gasPrice);

      //  check polygon
      if (chainId == 137) {
        // 100 gwei set gasPrice to 100 gwei
        if (parseInt(gasPrice) > 100 * 1e9) {
          gasPrice = (100 * 1e9).toString();
        }
      } else {
        gasPrice = (5 * 1e9).toString();
      }

      const data = tx.encodeABI();
      const nonce = await web3.eth.getTransactionCount(this.BOT_WALLET_ADDRESS);
      console.log('Attempting to send tx', chainId, gasPrice, contractBotId);

      const signedTx = await web3.eth.accounts.signTransaction(
        {
          to: contract.options.address,
          data,
          gas,
          gasPrice,
          nonce,
          chainId,
        },
        this.BOT_WALLET_PRIVATE_ADDRESS,
      );

      const receipt = await web3.eth.sendSignedTransaction(
        signedTx.rawTransaction,
      );
      // ! BUG HERE AS WELL
      // QueryFailedError: null value in column "effecitveGasPrice" of relation "transaction" violates not-null constraint -- many more errors
      // this.transactionService.recordTransaction(receipt, contractBotId);
    } catch (error) {
      // ! ALERT  TypeError: this.logger.crit is not a function -> changed to info for now
      this.logger.info(`BOT ID ${contractBotId} \nERROR on sending: ${error}`);
    }
  }

  /**
   * @notice Method can be only called in dev
   * @param chainId
   * @param botId
   * @returns
   */
  public async forceAttemptRun(chainId: number, botId: number) {
    const currentEnv = this.configService.get<string>('NODE_ENV');
    if (currentEnv != 'dev') {
      throw new ConflictException('This can only be called in DEV environment');
    }

    //web3
    const web3 = await this.networkService.getWeb3(chainId);
    //contract
    const contract = await this.networkService.getTraderContract(chainId);
    this.attemptRun(chainId, botId, web3, contract);

    return;
  }

  private async lockBot(id: string) {
    return await this.update(id, { isLocked: true });
  }

  private async unlockBot(id: string) {
    return await this.update(id, { isLocked: false });
  }

  private async getLockState(botUUID: string) {
    const bot = await this.findByUUID(botUUID);
    const { isLocked } = bot;
    return isLocked;
  }

  async isRunning(_chainId: number, _contractBotId: number) {
    const bot = await this.findByChainIdAndBotId(_chainId, _contractBotId);
    const { isRunning } = bot;
    return isRunning;
  }

  /**
   *
   * @param id bot uuid`
   * @returns int
   */
  public async incrementPeriod(chainId: number, botId: number) {
    const bot = await this.findByChainIdAndBotId(chainId, botId);
    const updatedPeriod = bot.currentPeriod + 1;
    const id = await this.getUUIDByChainIdAndBotId(chainId, botId);
    await this.update(id, { currentPeriod: updatedPeriod });
    return updatedPeriod;
  }

  /**
   *
   * @param id
   * @returns int
   */
  public async getCurrentPeriod(chainId: number, botId: number) {
    try {
      const bot = await this.findByChainIdAndBotId(chainId, botId);
      return bot.currentPeriod;
    } catch (error) {
      return 0;
    }
  }

  public async updatePeriod(chainId: number, botId: number, period: number) {
    try {
      const id = await this.getUUIDByChainIdAndBotId(chainId, botId);

      await this.update(id, { currentPeriod: period });
      return period;
    } catch (error) {
      return;
    }
  }
}
