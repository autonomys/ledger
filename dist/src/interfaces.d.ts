import { IImmutableRecord, IImmutableRecordValue } from "../node_modules/@subspace/database/src/interfaces";
export interface IAccount {
    balance: IBalance;
    pledge: IPledge;
    contracts: Set<IContract>;
}
export interface IBalance {
    cleared: number;
    pending: number;
}
export interface IPledge {
    txId: string;
    size: number;
    interval: number;
    proof: string;
    createdAt: number;
}
export interface IContract {
    txId: string;
    createdAt: number;
    spaceReserved: number;
    replicationFactor: number;
    ttl: number;
    contractSig: string;
    contractId: string;
}
export interface IChain {
    blocks: Set<string>;
}
export interface IChainBlock {
    value: IBlockValue;
    valid: boolean;
    cleared: boolean;
}
export interface IChainTx {
    value: ITxValue;
    valid: boolean;
    cleared: boolean;
}
export interface IBlock extends IImmutableRecord {
    value: IBlockValue;
}
export interface IBlockValue extends IImmutableRecordValue {
    content: IBlockContent;
}
export interface IBlockContent {
    previousBlock: string;
    creditSupply: number;
    spacePledged: number;
    immutableReserved: number;
    mutableReserved: number;
    immutableCost: number;
    mutableCost: number;
    solution: string;
    proof: number;
    publicKey: string;
    signature: string;
    txSet: Set<string>;
}
export interface ITx extends IImmutableRecord {
    value: ITxValue;
}
export interface ITxValue extends IImmutableRecordValue {
    content: IRewardTxContent | ICreditTxContent | IPledgeTxContent | IContractTxContent | INexusTxContent;
}
export interface ITxContent {
    type: string;
    sender: string;
    receiver: string;
    amount: number;
    cost: number;
    signature: string;
}
export interface IRewardTxContent extends ITxContent {
    type: 'reward';
}
export interface ICreditTxContent extends ITxContent {
    type: 'credit';
}
export interface IPledgeTxContent extends ITxContent {
    type: 'pledge';
    pledgeProof: string;
    spacePledged: number;
    pledgeInterval: number;
    seed: string;
}
export interface IContractTxContent extends ITxContent {
    type: 'contract';
    spaceReserved: number;
    ttl: number;
    replicationFactor: number;
    recordIndex?: Set<string>;
    contractSig: string;
    contractId: string;
}
export interface INexusTxContent extends ITxContent {
    type: 'nexus';
    pledgeTx: string;
}
