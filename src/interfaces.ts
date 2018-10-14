export interface Proof {
  id: string          // hash of my proof chain
  size: number        // size of proof in GB
  seed: string        // my public key 
  plot: string[]      // the actual proof chain
  createdAt: number  // when created
}

export interface Block {
  key: string           // hash of block value
  value: {
    height: number      // block sequence number
    lastBlock: string   // hash of previous block
    solution: string    // closest solution by XOR
    time: number        // time in ms after last block
    pledge: number      // size of pledge of block winner
    timestamp: number   // time block is published
    reward: Tx          // coin base tx
    nexus: Tx[]         // all nexus payments
    txs: string[]       // array of txs in this block
    key: string         // public key of proposer
    spacePledged: number 
    immutableSpaceReserved: number
    mutableSpaceReserved: number
    costOfMutableStorage: number
    costOfImmutableStorage: number
    signature: string   // signature of proposer
  }
}

export interface Tx {
  key: string           // hash of tx value
  value: {
    type: string
    sender: string      // full public key of sender
    receiver: string    // address of sender
    amount: number       // simple ledger to start
    fee: number         // fee for this tx (size based)
    script: any         // dummy contract info (pledge or reservation)
    timeStamp: number   // time when transaction is published
    signature: string   // signature of sender
  }
}

export interface PledgeScript {
  proof: string     // hash of my proofchain (proof id)
  size: number      // number of GB pledged
  interval: number  // days between payments
}

export interface ContractScript {
  key: string       // contract public key 
  size: number      // size of contract in GB
  ttl: number       // time-to-live in ms
  replicas: number  // number of replicas for each shard or object
  signature: string // signature of contract using contract key 
}

export interface NexusScript {
  receiver: string  // address of host being payed (hash)
  amount: number    // weighted payment
  contract: string  // host pledge tx 
}

// same as profile (need to dedupe)
export interface Contract {
  id: string                
  name: string
  email: string
  passphrase: string              
  reserved: number             
  ttl: number               
  timestamp: number         
  replicas: number          
  publicKeyArmored: string  
  privateKeyArmored: string 
  records: string[]         
  used: number
  acl: string[]            
}

export interface PledgeData {
  host: string
  interval: number
  blockDue: number
  size: number
  pledge: string
}

export interface ContractData {
  client: string,
  size: number
  ttl: number 
}

// For later, when ready to switch to full UTXO model

export interface Input {
  sender: string        // full public key of sender
  amount: number        // number of subspace credits
  signature: string     // signature authorizing this input
}

export interface Output {
  recipient: string     // full public key of receipient
  amount: number        // amount to be sent to this recipient
}

