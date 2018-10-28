
export interface IBlock {
  // Ledger Data
  height: number            // block sequence number
  previousBlock: string         // hash of previous block
  spacePledged: number 
  immutableReserved: number
  mutableReserved: number
  immutableCost: number
  mutableCost: number
  creditSupply: number
  hostCount: number

  // Proposer Data
  solution: string      // farmer closest solution by XOR
  pledge: number        // size of pledge of proposing farmer
  publicKey: string     // full public key of farmer
  signature: string     // farmer signature

  // Tx Data
  txSet: Set<string>    // set of tx in the block
}

export interface ITx {
  type: string
  sender: string      // full public key of sender
  receiver: string    // address of receiver
  amount: number      // simple ledger to start
  cost: number        // tx cost = immutable storage cost + miner fee
  signature: string   // sender signature, authorizing the transfer

  // optional reward tx data
  previousBlock?: string
  
  // optional pledge tx data
  pledgeProof?: string
  spacePledged?: number
  pledgeInterval?: number

  // optional contract tx data
  spaceReserved?: number
  ttl?: number
  replicationFactor?: number
  contractKey?: string
  contractSignature?: string
  recordIndex?: Set<string>

  // nexus tx data
  pledgeTx?: string   // host pledge tx id 
}

export interface IPledge {
  host: string
  size: number
  interval: number
  proof: string
  createdAt: number
}

export interface IContract {
  publicKey: string
  clientKey: string
  spaceReserved: number
  replicationFactor: number
  ttl: number
  createdAt: number
}
