const crypto = require('subspace-crypto').default
const profile = require('subspace-profile').default
const storage = require('subspace-storage').default

interface input {
  sender: string,       // full public key of sender
  amount: number,       // number of subspace credits
  signature: string     // signature authorizing this input
}

interface output {
  recipient: string,    // full public key of receipient
  amount: number        // amount to be sent to this recipient
}

interface tx {
  key: string,          // hash of tx value
  value: {
    sender: string,     // full public key of sender
    inputs: input[],    // array of inputs
    outputs: output[],  // array of outputs
    fee: number,        // fee for this tx (size based)
    script: string,     // dummy contract info
    timeStamp: number,  // time when transaction is published
    signature: string   // signature of sender
  }
}

interface block {
  key: string,          // hash of block value
  value: {
    lastBlock: string,  // hash of previous block
    solution: {
      value: string,    // closest solution by XOR
      pledge: string,   // published pledge tx
      key: string,      // public key of proposer (seed)
      index: number     // index for iterative hash 
    }
    timestamp: number,  // time block is published
    txs: tx[],          // array of txs in this block
    signature: string,  // signature of proposer
  }
}



// Event Model (one level above this module, from RPC events)
  // on proposed block 
    // validate this block solution
    // validate each tx
    // if block valid 
      // compute UTXO
        // if address in UTXO, mutate balance
        // else add address and set balance
      // save block to disk
      // remove each tx from memory pool that is valid 
      // compute by best solution and construct empty block
      // add all pending tx in memory pool
    // continue listening for other blocks and adjust solution
    
  // on proposed tx 
    // validate the tx
    // add to memory pool
    // adjust UTXO pending balance
      // if address in UTXO, mutate balance
      // else add address
    // add to my proposed block

// on startup
  // check for saved blocks -> compute balance for each block
  // get all blocks from network -> compute balance for each block
  // get all pending txs from network -> compute balance for each tx
  // for each compute balance
   // recompute UTXO
   // recompute pending UTXO

interface pending {
  tx: string,
  published: boolean
}

const Ledger = {
  blocks: <string[]> [],      // array of all valid block hashes tracked at this node, index for block storage
  memoryPool: <pending[]> [], // array of all tx not in a valid block, when valid block is selected, matched txs are removed
  utxo: <any> new Map(),      // map of all addresses and current balance
  init: () => {
    // check for saved blocks
    // if yes, then start reading at block 0
  },
  computeUtxo: () => {
    // for each block
      // for each tx
        // apply all inputs
        // apply all outputs


  },
  getBalance: (address: string) => {
    const balance: number = Ledger.utxo.get(address)
    return balance
  },
  createProof: (key: string, space: number) => {
    const proofArray: string[] = []
    const hashCount: number = space * 1000

    for (let i: number = 0; i < hashCount; i++ ) {
      key = crypto.getHash(key)
      proofArray.push(key)
    }

    const proofHash: string = crypto.getHash(proofArray.toString())
    const proof: any = { proofHash, proofArray }
    return proof
  },
  validateProof: (key:string, space: number, proof: string) => {
    if (Ledger.createProof(key, space).proofHash === proof) {
      return true
    } else {
      return false
    }
  },
  createTx: (dst: string, amount: number) => {

    // check balance
    if (!(amount <= Ledger.getBalance(profile.hexId))) {
      return false
    }

  }
}

export default Ledger

