import {
  ConflictException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateNetworkDto } from '../dto/create-network.dto';
import { UpdateNetworkDto } from '../dto/update-network.dto';
import { Network } from '../entity/network.entity';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { DCA_MANAGER_ABI, DCA_TRADER_ABI } from '../constants/contract_info';

@Injectable()
export class NetworkService {
  constructor(
    @InjectRepository(Network)
    private readonly networkRepository: Repository<Network>,
  ) {
    // this.printNetworks();
  }

  async printNetworks() {
    // loop over all networks created
    const networks = await this.networkRepository.find();
    console.log('networks:', networks);
  }

  /**
   *
   * @param createNetworkDto
   * @returns network
   * * Prereq: valid RPC and contract address
   */
  async create(createNetworkDto: CreateNetworkDto) {
    const { chainId, traderContractAddress, managerContractAddress, RPC } =
      createNetworkDto;
    // make sure that upon creation, no network with the same chainId exist
    const created = await this.networkCreated(chainId);

    if (created === true) {
      throw new PreconditionFailedException('Network already created');
    }

    //validate network RPC
    const isConnected = await this.testRPCConnection(RPC[0]);
    if (isConnected === false) {
      throw new PreconditionFailedException('Could not connect to RPC');
    }

    //validate contract address with isAddress
    const web3 = new Web3(RPC[0]);
    const isAddress = this.isValidAddress(web3, traderContractAddress);
    const isManagerAddress = this.isValidAddress(web3, managerContractAddress);
    if (isAddress === false || isManagerAddress === false) {
      throw new PreconditionFailedException('Invalid contract address');
    }

    const network = this.networkRepository.create({
      ...createNetworkDto,
    });

    return await this.networkRepository.save(network);
  }

  async update(networkUUID: string, updateNetworkDto: UpdateNetworkDto) {
    const network = await this.findbyUUID(networkUUID);
    return await this.networkRepository.update(networkUUID, updateNetworkDto);
  }

  /**
   *
   * ERROR [ExceptionsHandler] update or delete on table "network" violates foreign key constraint "FK_593f0422d9f17327636a05478b6" on table "bot"
   */
  async remove(chainId: number) {
    try {
      const network = await this.findByChainId(chainId);
      return await this.networkRepository.remove(network);
    } catch {
      throw new ConflictException(
        `Cannot delete network due to existing bots connected to this RPC. Remove bots under this network first before calling this endpoint`,
      );
    }
  }

  public async findbyUUID(networkUUID: string) {
    const network = await this.networkRepository.findOne(networkUUID);
    if (!network) {
      throw new NotFoundException('Unknown network');
    }
    return network;
  }

  public async findByChainId(chainId: number) {
    const network = await this.networkRepository.findOne({ chainId: chainId });
    if (!network) {
      throw new NotFoundException('Unknown network');
    }
    return network;
  }

  /**
   *
   * @param chainId
   *
   * @returns true/false if this network already exists
   *
   */
  private async networkCreated(chainId: number) {
    const network = await this.networkRepository.findOne({ chainId: chainId });
    if (network) {
      return true;
    } else {
      return false;
    }
  }

  /**
   *
   * @param chainId
   * @returns the trader contract object
   */
  public async getTraderContract(chainId: number) {
    // obtain the network object
    const network = await this.findByChainId(chainId);

    // establish web3 object using network rpc
    const { RPC, traderContractAddress } = network;

    // establish contract
    const web3: Web3 = new Web3(RPC[0]);
    const contract: Contract = new web3.eth.Contract(
      DCA_TRADER_ABI,
      traderContractAddress,
    );

    return contract;
  }

  /**
   *
   * @param chainId
   * @returns the manager contract object
   */
  public async getManagerContract(chainId: number) {
    // obtain the network object
    const network = await this.findByChainId(chainId);

    // establish web3 object using network rpc
    const { RPC, managerContractAddress } = network;

    // establish contract
    const web3: Web3 = new Web3(RPC[0]);
    const contract: Contract = new web3.eth.Contract(
      DCA_MANAGER_ABI,
      managerContractAddress,
    );

    return contract;
  }

  /**
   *
   * @param chainId
   * @returns the web3 object for the given chain
   */
  public async getWeb3(chainId: number) {
    // obtain the network object
    const network = await this.findByChainId(chainId);

    // establish web3 object using network rpc
    const { RPC } = network;

    // establish contract
    const web3: Web3 = new Web3(RPC[0]);

    return web3;
  }

  /**
   *
   * @param RPC string
   * @returns boolean
   *
   */
  async testRPCConnection(RPC: string) {
    const web3 = new Web3(new Web3.providers.WebsocketProvider(RPC));
    try {
      let netIsListening = await web3.eth.net.isListening();
    } catch (error) {
      return false;
    }
    return true;
  }

  /**
   *
   * @param web3
   * @param address
   * @returns boolean
   */
  isValidAddress(web3: Web3, address: string) {
    const valid = web3.utils.checkAddressChecksum(address);
    return valid;
  }
  /**
   *
   * @returns array of unique RPCs
   */
  async getRPCs() {
    const result = await this.networkRepository.find({ select: ['RPC'] });

    //parse RPC into array
    let RPC = [];
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result[i]['RPC'].length; j++) {
        RPC.push(result[i]['RPC'][j]);
      }
    }

    //remove duplicates from array
    RPC = RPC.filter(function (elem, index, self) {
      return index == self.indexOf(elem);
    });

    return RPC;
  }

  async getNetworks() {
    return await this.networkRepository.find();
  }
}
