
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
