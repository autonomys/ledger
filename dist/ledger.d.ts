import { IPledge, IContract, IChainBlock, IChainTx, IBlock, ITx, IBlockValue, IBlockContent, ITxContent, IRewardTxContent, ICreditTxContent, IPledgeTxContent, INexusTxContent, IContractTxContent, IAccount, ITxValue } from './interfaces';
import { ImmutableRecord, IImmutableRecord } from '@subspace/database';
import Wallet, { IProfileObject } from '@subspace/wallet';
import Storage from '@subspace/storage';
import { EventEmitter } from 'events';
export { IBlock, ITx, IBlockValue, IBlockContent, ITxContent, IRewardTxContent, ICreditTxContent, IPledgeTxContent, INexusTxContent, IContractTxContent, IAccount, ITxValue };
export declare class Ledger extends EventEmitter {
    storage: Storage;
    wallet: Wallet;
    chain: {
        blockIds: Set<string>;
        lastBlock: IBlock;
        length: number;
        addBlock: (blockId: string) => Promise<void>;
        removeBlock: (blockId: string) => Promise<void>;
    };
    blockPool: {
        blocks: Map<string, IChainBlock>;
        blockIds: string[];
        bestBlock: Block;
        addBlock: (block: Block, valid: boolean, cleared: boolean) => Promise<void>;
        getBlock: (key: string) => Promise<IChainBlock>;
        getBlockRecord: (key: string) => Promise<Block>;
        applyBlock: (key: string) => Promise<void>;
        revertBlock: (key: string) => Promise<void>;
        expireBlock: (key: string) => Promise<void>;
        getBlocks: (valid?: boolean, cleared?: boolean) => IImmutableRecord[];
    };
    txPool: {
        txs: Map<string, IChainTx>;
        addTx: (tx: Tx, valid: boolean, cleared: boolean) => void;
        getTx: (key: string) => Promise<IChainTx>;
        getTxRecord: (key: string) => Promise<Tx>;
        applyTx: (key: string) => Promise<void>;
        revertTx: (key: string) => Promise<void>;
        expireTx: (key: string) => Promise<void>;
        getTxs: (valid?: boolean, cleared?: boolean) => ITx[];
    };
    contracts: {
        _contracts: Map<string, IContract>;
        addContract: (address: string, contract: IContract) => void;
        getContract: (contractTxId: string) => any;
        expireContract: () => void;
    };
    accounts: {
        _accounts: Map<string, IAccount>;
        createAccount: (address: string) => void;
        getAccount: (address: string) => IAccount;
        getActiveBalance: (address: string) => number;
        getPendingBalance: (address: string) => number;
        getPledge: (address: string) => any;
        getContract: (address: string) => any;
        getOrCreateAccount: (address: string) => IAccount;
        updateBalance: (address: string, update: number, type: "pending" | "cleared") => void;
        addPledge: (address: string, pledge: IPledge) => void;
        expirePledge: (address: string) => void;
        addContract: (address: string, contract: IContract) => void;
        expireContract: (address: string, contractId: string) => void;
    };
    proofOfTime: NodeJS.Timeout;
    isFarming: boolean;
    hasLedger: boolean;
    constructor(storage: Storage, wallet: Wallet);
    getHeight(): number;
    getLastBlock(): IBlock;
    getLastBlockId(): string;
    getImmutableCost(): number;
    getMutableCost(): number;
    setBlockTime(blockTime: number): void;
    static computeMutableCost(creditSupply: number, spaceAvailable: number): number;
    static computeImmutableCost(mutableCost: number, mutableReserved: number, immutableReserved: number): number;
    computeHostPayment(uptime: number, spacePledged: number, interval: number, pledgeTxId: string): Promise<number>;
    bootstrap(spacePledged?: number, pledgeInterval?: number): Promise<void>;
    solveBlockChallenge(block: Block, previousBlockId: string): Promise<NodeJS.Timeout>;
    private isBestProofOfSpace;
    private buildBlock;
    private farmNextBlock;
    onBlock(block: Block): Promise<{
        valid: boolean;
        reason: string;
    }>;
    onTx(tx: Tx): Promise<{
        valid: boolean;
        reason: string;
    }>;
    onTxCreated(tx: Tx): Promise<void>;
    onTxReceived(txData: ITx): Promise<void>;
    applyTx(tx: Tx, type: 'pending' | 'cleared'): Promise<{
        farmerPayment: number;
        nexusPayment: number;
    }>;
    revertTx(): Promise<void>;
    onBlockCreated(block: Block): Promise<void>;
    onBlockReceived(blockData: IBlock): Promise<void>;
    revertBlock(): Promise<void>;
    createRewardTx(receiver: string, amount: number, timestamp: number): Promise<Tx>;
    createCreditTx(sender: string, receiver: string, amount: number): Promise<Tx>;
    createPledgeTx(proof: string, size: number, interval?: number): Promise<Tx>;
    createNexusTx(pledgeTx: string, amount: number): Promise<Tx>;
    createImmutableContractTx(sender: string, spaceReserved: number, records: Set<string>): Promise<Tx>;
    createMutableContractTx(spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string): Promise<Tx>;
}
export declare class Block extends ImmutableRecord implements IBlock {
    constructor();
    static init(content: IBlockContent): Promise<Block>;
    static loadBlockFromData(blockData: IBlock): Promise<Block>;
    cast(profile: IProfileObject): Promise<this>;
    addTx(tx: ITx): void;
    setMutableCost(): void;
    setImmutableCost(): void;
    isValidGenesisBlock(block: Block): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidBlock(newBlock: Block, previousBlock: {
        key: string;
        value: Block['value'];
    }): Promise<{
        valid: boolean;
        reason: string;
    }>;
    computeProofOfSpace(plot: Set<string>, previousBlock: string): string;
    isValidProofOfSpace(publicKey: string, previousBlock: string): boolean;
    computeHamming(src: string, dst: string): number;
    getTimeDelay(seed?: string): number;
    sign(privateKeyObject: any): Promise<void>;
    isValidSignature(): Promise<boolean>;
}
export declare class Tx extends ImmutableRecord implements ITx {
    constructor();
    static createRewardTx(receiver: string, amount: number, immutableCost: number, timestamp: number): Promise<Tx>;
    static createCreditTx(sender: string, receiver: string, amount: number, immutableCost: number, profile: IProfileObject): Promise<Tx>;
    static createPledgeTx(proof: string, spacePledged: number, interval: number, immutableCost: number, profile: IProfileObject): Promise<Tx>;
    static createNexusTx(amount: number, pledgeTx: string, immutableCost: number, profile: IProfileObject): Promise<Tx>;
    static createImmutableContractTx(sender: string, cost: number, spaceReserved: number, records: Set<string>, immutableCost: number, profile: IProfileObject): Promise<Tx>;
    static createMutableContractTx(spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string, immutableCost: number, profile: IProfileObject): Promise<Tx>;
    static loadTxFromData(txData: ITx): Promise<Tx>;
    protected cast(content: ITxContent, profile: IProfileObject, immutableCost: number): Promise<this>;
    isValidTx(size: number, immutableCost: number, mutableCost?: number, senderBalance?: number, hostCount?: number): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidPledgeTx(response: any): any;
    isValidContractTx(response: any, hostCount: number, mutableCost: number, immutableCost: number): Promise<any>;
    isValidNexusTx(response: any): any;
    getCostofStorage(immutableCost: number): number;
    getReceiverAddress(): string;
    getSenderAddress(): string;
    isValidSignature(): Promise<boolean>;
    private setTxCost;
    private sign;
}
