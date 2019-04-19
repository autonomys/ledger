import { IImmutableRecord, IImmutableRecordValue } from '@subspace/database'

export interface IAccount {
  balance: IBalance
  pledge: IPledge
  contracts: Set<IContract>
}

export interface IBalance {
  cleared: number   // as of last block on chain
  pending: number   // as of valid txs in pool 
}

 export interface IPledge {
  txId: string // id of cleared tx
  size: number
  interval: number
  proof: string
  createdAt: number
}

export interface IContract {
  txId: string // id of cleared tx 
  createdAt: number
  spaceReserved: number
  replicationFactor: number
  ttl: number
  contractSig: string
  contractId: string // hash of contract public key 
}

export interface IChain {
  blocks: Set<string>
}

export interface IChainBlock {
  value: IBlockValue
  valid: boolean
  cleared: boolean
}

export interface IChainTx {
  value: ITxValue
  valid: boolean
  cleared: boolean
}

export interface IBlock extends IImmutableRecord {
  value: IBlockValue
}

export interface IBlockValue extends IImmutableRecordValue {
  content: IBlockContent
}

export interface IBlockContent {
    previousBlock: string         // hash of the previous block
    creditSupply: number        // total cicrulating credits created
    spacePledged: number        // total space pledged as of this block
    immutableReserved: number   // total immutable space reserved
    mutableReserved: number     // total mutable space reserved
    immutableCost: number       // immutable cost of storage for next round
    mutableCost: number         // mutable cost of storage for next round
    solution: string            // this farmers closest solution by XOR
    proof: number              // size of this farmer's pledge (later commitment)
    publicKey: string           // full public key of farmer
    signature: string           // farmer signature
    txSet: Set<string>          // set of included tx ids (gossiped seperately on creation)
}

export interface ITx extends IImmutableRecord {
  value: ITxValue
}

export interface ITxValue extends IImmutableRecordValue {
  content: IRewardTxContent | ICreditTxContent | IPledgeTxContent | IContractTxContent | INexusTxContent 
}

export interface ITxContent {
  type: string        // tx type
  sender: string      // public key of sender
  receiver: string    // public key of receiver 
  amount: number      // amount being sent
  cost: number        // tx fee (to farmer) + immutable storage cost (to nexus)
  signature: string   // sender signature
}

export interface IRewardTxContent extends ITxContent {
  type: 'reward'
}

export interface ICreditTxContent extends ITxContent {
  type: 'credit'
}

export interface IPledgeTxContent extends ITxContent {
  type: 'pledge'
  pledgeProof: string
  spacePledged: number
  pledgeInterval: number
  seed: string
}

export interface IContractTxContent extends ITxContent {
  type: 'contract'
  spaceReserved: number
  ttl: number
  replicationFactor: number
  recordIndex?: Set<string>
  contractSig: string
  contractId: string
}

export interface INexusTxContent extends ITxContent {
  type: 'nexus'
  pledgeTx: string
}