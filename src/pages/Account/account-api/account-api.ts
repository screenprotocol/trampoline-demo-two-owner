import { BigNumber, BigNumberish, ethers, Wallet } from 'ethers';
import {
  SimpleAccount,
  SimpleAccount__factory,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  UserOperationStruct,
} from '@account-abstraction/contracts';
import { arrayify, hexConcat } from 'ethers/lib/utils';
import Config from '../../../exconfig';
import { AccountApiParamsType, AccountApiType } from './types';
import { MessageSigningRequest } from '../../Background/redux-slices/signing';
import { TransactionDetailsForUserOp } from '@account-abstraction/sdk/dist/src/TransactionDetailsForUserOp';
import {
  TwoOwnerAccount,
  TwoOwnerAccountFactory,
  TwoOwnerAccountFactory__factory,
  TwoOwnerAccount__factory,
} from './typechain-types';

const FACTORY_ADDRESS =
  Config.factory_address || '0x6c0ec05Ad55C8B8427119ce50b6087E7B0C9c23e';

/**
 * An implementation of the BaseAccountAPI using the SimpleAccount contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
class TwoOwnerAccountAPI extends AccountApiType {
  name: string;
  factoryAddress?: string;
  ownerOne: Wallet;
  ownerTwo: string;
  index: number;

  /**
   * our account contract.
   * should support the "execFromEntryPoint" and "nonce" methods
   */
  accountContract?: TwoOwnerAccount;

  factory?: TwoOwnerAccountFactory;

  constructor(
    params: AccountApiParamsType<
      { address: string },
      { privateKey: string; ownerTwo: string }
    >
  ) {
    super(params);
    this.factoryAddress = FACTORY_ADDRESS;

    this.ownerOne = params.deserializeState?.privateKey
      ? new ethers.Wallet(params.deserializeState?.privateKey)
      : ethers.Wallet.createRandom();

    this.ownerTwo = params.deserializeState?.ownerTwo
      ? params.deserializeState?.ownerTwo
      : params.context?.address || '';
    this.index = 0;
    this.name = 'SimpleAccountAPI';
  }

  serialize = async (): Promise<{ privateKey: string; ownerTwo: string }> => {
    return {
      privateKey: this.ownerOne.privateKey,
      ownerTwo: this.ownerTwo,
    };
  };

  async _getAccountContract(): Promise<TwoOwnerAccount> {
    if (this.accountContract == null) {
      this.accountContract = TwoOwnerAccount__factory.connect(
        await this.getAccountAddress(),
        this.provider
      );
    }
    return this.accountContract;
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode(): Promise<string> {
    if (this.factory == null) {
      if (this.factoryAddress != null && this.factoryAddress !== '') {
        this.factory = TwoOwnerAccountFactory__factory.connect(
          this.factoryAddress,
          this.provider
        );
      } else {
        throw new Error('no factory to get initCode');
      }
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData('createAccount', [
        await this.ownerOne.getAddress(),
        this.ownerTwo,
        this.index,
      ]),
    ]);
  }

  async getNonce(): Promise<BigNumber> {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0);
    }
    const accountContract = await this._getAccountContract();
    return await accountContract.getNonce();
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  async encodeExecute(
    target: string,
    value: BigNumberish,
    data: string
  ): Promise<string> {
    const accountContract = await this._getAccountContract();
    return accountContract.interface.encodeFunctionData('execute', [
      target,
      value,
      data,
    ]);
  }

  async signOwnerOne(userOpHash: string): Promise<string> {
    return await this.ownerOne.signMessage(arrayify(userOpHash));
  }

  signMessage = async (
    context: any,
    request?: MessageSigningRequest
  ): Promise<string> => {
    return this.ownerOne.signMessage(request?.rawSigningData || '');
  };

  signUserOpWithContext = async (
    userOp: UserOperationStruct,
    context: { signedMessage: string }
  ): Promise<UserOperationStruct> => {
    return {
      ...userOp,
      signature: ethers.utils.defaultAbiCoder.encode(
        ['bytes', 'bytes'],
        [
          await this.signOwnerOne(await this.getUserOpHash(userOp)),
          context.signedMessage,
        ]
      ),
    };
  };

  async createUnsignedUserOp(
    info: TransactionDetailsForUserOp
  ): Promise<UserOperationStruct> {
    const userOp = await super.createUnsignedUserOp(info);
    await userOp.preVerificationGas;
    userOp.preVerificationGas = Number(await userOp.preVerificationGas) * 2.5;
    return userOp;
  }

  getUserOpHashToSign = async (userOp: UserOperationStruct) => {
    return this.getUserOpHash(userOp);
  };
}

export default TwoOwnerAccountAPI;
