import {IPledge, IContract, IChain, IChainBlock, IChainTx, IBlock, ITx, IBlockValue, IBlockContent, ITxContent, IRewardTxContent,  ICreditTxContent, IPledgeTxContent, INexusTxContent, IContractTxContent, IAccount} from './interfaces'
import * as crypto from '@subspace/crypto'
import { getClosestIdByXor } from '@subspace/utils'
import {Record, ImmutableRecord, IImmutableRecord } from '@subspace/database'
import Wallet, { IProfileObject } from '@subspace/wallet'
import Storage from '@subspace/storage'
import { EventEmitter } from 'events'
import { resolve } from 'path'

export { IBlock, ITx, IBlockValue, IBlockContent, ITxContent, IRewardTxContent, ICreditTxContent, IPledgeTxContent, INexusTxContent, IContractTxContent, IAccount }

// TODO for next iteration
  // Add nonces to txs and verify nonces are applied correctly across accounts
  // Create a merkle tree of txs, generate roots, proofs, and verify
  // implement a simple smart contract lanague?


// Design Notes

// all ledger tx are immutable SSDB records
// each block has a unqiue immutable storage contract 
// tx storage costs are part of the fee, which is paid to the nexus
// the block storage contract is added to the subsequent block and paid out of the nexus
// tx fees for pledges and pledge payments are borrowed from the nexus by hosts
// the reward tx and block storage contract tx are canonical/deterministic, any node can create if they have the block header
// host must request payment for hosting at the end of interval by submitting a valid nexus tx
// if a host does not collect payment then the nexus just keeps any funds paid 
// if the block includes short hashes of 8 bytes for each tx and those txs can be resolved to SSDB hashes to generate the full record id, you could store 120k tx per block 
// tx's do not need to know their block or contract
// records do not need to know their contracts, but contracts must know their records
// contract signatures are only required on put/rev/del ops 
 // blocks and tx do not know about their storage contract
// block storage contracts are created after the block is published and included in the next block, based on the cost of storage in the last block
// the block storage contract tx (immutable) stores a set of all records in the contract


// A few constants

const YEAR_IN_MS = 31536000000           // 1 year in ms
const MONTH_IN_MS = 2628000000           // 1 momth in ms
const HOUR_IN_MS = 3600000               // 1 hour in ms 
let BLOCK_IN_MS = 600000                 // 10 min by default, can be overridden for testing
const MIN_PLEDGE_INTERVAL = MONTH_IN_MS  // minium/standard pledge interval for a host
const BLOCKS_PER_MONTH = 43200           // 1 min * 60 * 24 * 30 = 43,200 blocks
const BYTES_PER_HASH = 1000000           // one hash per MB of pledge for simple proof of space, 32 eventually
const INITIAL_BLOCK_REWARD = 100         // intial block reward ins subspace credits
const MIN_IMMUTABLE_CONTRACT_SIZE = 1000   // 1 KB
const MIN_MUTABLE_CONTRACT_SIZE = 100000000  // 100 MB
const MAX_IMMUTABLE_CONTRACT_SIZE = .001 * this.spaceAvailable
const MAX_MUTABLE_CONTRACT_SIZE = .1 * this.spaceAvailable
const MIN_PLEDGE_SIZE = 10000000000      // 10 GB in bytes
const MAX_PLEDGE_SIZE = 10000000000       // 10 GB for now
const NEXUS_ADDRESS = crypto.getHash('nexus')
const TX_FEE_MULTIPLIER = 1.02


/* 
  Basic Cases

  (1) Create the genesis block locally and start a new chain
  (2) Create a new block locally and apply to existing chain
  (3) Receive a new block over the network and apply to head of existing chain
  (4) Receive a new block over the network and apply to a past block of existing chain (fork)
  (5) Not farming but still want to validate and gossip blocks 

*/

export class Ledger extends EventEmitter {

  public chain = {
    // TODO: Persist to disk, else must be compiled on startup
      // maybe chain should be a graph
    // methods are only called by blockPool object
        // extend the chain when a new block is applied (cleared) in the blockpool
        // revert/roll-back the chain when an existing block is reverted in the blockPool
    blockIds: new Set<string>(),    // all blocks that have been applied, inserted in chronological order (oldest block first)
    lastBlock: <IBlock> null,     // the last (most recent) block applied to the ledger
    length: <number> 0,           // length is cached since it could be expensive to fetch for long chains
    addBlock: async (blockId: string) => {
      // add a new block to the chain
      this.chain.blockIds.add(blockId)
      const blockValue = (await this.blockPool.getBlock(blockId)).value
      this.chain.lastBlock = {
        key: blockId,
        value: blockValue
      }
      this.chain.length = this.chain.blockIds.size
    },
    removeBlock: async (blockId: string) => {
      // remove a block and all descendants
      if (this.chain.blockIds.has(blockId)) {
        const parentId = ( await this.blockPool.getBlock(blockId)).value.content.previousBlock
        let descendantId = this.chain.lastBlock.key
        while (descendantId !== parentId) {
          await this.blockPool.revertBlock(descendantId)
          this.chain.blockIds.delete(descendantId)
          descendantId = ( await this.blockPool.getBlock(descendantId)).value.content.previousBlock
        }
        const parentValue = (await this.blockPool.getBlock(parentId)).value
        this.chain.lastBlock = {
          key: parentId,
          value: parentValue
        }
        this.chain.length = this.chain.blockIds.size
      }
    }
  }
  
  public blockPool = {
    // add block
      // when a new block is created by this node (genesis or subsequent block)
      // when a new valid block is received from another node
        // that has a better solution than my best block 
        // that has a better solution than a block in my chain (maybe late gossip) -- within limits
    blocks: new Map<string, IChainBlock>(),   // last 100 blocks -- valid/invalid and cleared/pending
    blockIds: <string[]> [],
    bestBlock: <Block> null,
    addBlock: async (block: Block, valid: boolean, cleared: boolean) => {
      this.blockPool.blocks.set(block.key, {
          value: JSON.parse(JSON.stringify(block.value)),
          valid,
          cleared,
        }
      )
      this.blockPool.blockIds.push(block.key)
      // only store the last 100 blocks in memory
      if (this.blockPool.blocks.size > 100) {
        this.blockPool.expireBlock(this.blockPool.blockIds[0])
        this.blockPool.blockIds.splice(0, 1)
      }
    },
    getBlock: async (key: string) => {
      // TODO: if block is not on disk, get from the network?
      let memData = await this.blockPool.blocks.get(key)
      if(!memData) {
        const storedData = await this.storage.get(key)
        if (!storedData) {
          throw new Error('Block requested cannot be found on disk or in memory!')
        }
        memData = JSON.parse(JSON.stringify(memData))
        for (const txId of memData.value.content.txSet) {
          await this.txPool.getTx(txId)
        }
      } else {
        memData = JSON.parse(JSON.stringify(memData))
      }
      return memData
    },
    applyBlock: async (key: string) => {
      const blockData = await this.blockPool.getBlock(key)
      if (!blockData.cleared) {
        blockData.cleared = true
        this.blockPool.blocks.set(key, blockData)
        this.chain.addBlock(key)
        for (const txId of blockData.value.content.txSet) {
          this.txPool.applyTx(txId)
        }
      }
    },
    revertBlock: async (key: string) => {
      const blockData = await this.blockPool.getBlock(key)
      if (blockData.cleared) {
        blockData.cleared = false
        this.blockPool.blocks.set(key, blockData)
        this.chain.removeBlock(key)
        for (const txId of blockData.value.content.txSet) {
          this.txPool.revertTx(txId)
        }
      }
    },
    expireBlock: async (key: string) => {
      const blockData = await this.blockPool.getBlock(key)
      if (blockData.valid && blockData.cleared) {
        await this.storage.put(key, JSON.parse(JSON.stringify(blockData.value)))
      }
      for (const txId of blockData.value.content.txSet) {
        this.txPool.expireTx(txId)
      }
      this.blockPool.blocks.delete(key)
      const i = this.blockPool.blockIds.indexOf(key)
      this.blockPool.blockIds.splice(i, 1)
    },
    getBlocks: (valid = true, cleared = true) => {
      const results: IImmutableRecord[]  = []
      this.blockPool.blocks.forEach((value, key) => {
        if (value.valid === valid && value.cleared === cleared) {
          results.push({
            key: key, 
            value: value.value})
        }
      })
      return results
    }
  } 

  public txPool = {
    // TODO: need to expire tx's don't meet minimum feees
    // TODO: handle orphaned reward txs in the mem pool (i they are being added)
    // add tx
      // when a new tx is created on this node
      // when a new tx is received from another node (valid or invalid, applied when a block is created)
    txs: new Map<string, IChainTx>(),
    addTx: (tx: Tx, valid: boolean, cleared: boolean) => {
      // TODO: expire txs not in blocks 
      this.txPool.txs.set(tx.key, {
        value: JSON.parse(JSON.stringify(tx.value)),
        valid,
        cleared
      })
    },
    getTx: async (key: string) => {
      // TODO: if tx is not on disk, get from the network?
      let memData = this.txPool.txs.get((key))
      if (!memData) {
        const storedData = await this.storage.get(key)
        if (!storedData) {
          throw new Error('Tx request cannot be found on disk or in memory!')
        }
        memData = JSON.parse(storedData)
      }
      const txData: IChainTx = JSON.parse(JSON.stringify(memData))
      return txData
    },
    getTxRecord: async (key: string) => {
      const data = await this.txPool.getTx(key)
      const value = data.value
      return await Tx.loadTxFromData({key, value})
    },
    applyTx: async (key: string) => {
      const txData = await this.txPool.getTx(key)
      if (!txData.cleared && txData.valid) {
        txData.cleared = true
        this.txPool.txs.set(key, txData)
      }
    },
    revertTx: async (key: string) => {
      const txData = await this.txPool.getTx(key)
      if (txData.cleared) {
        txData.cleared = false
        this.txPool.txs.set(key, txData)
      }
    },
    expireTx: async (key: string) => {
      const txData = await this.txPool.txs.get(key)
      if (txData.valid && txData.cleared) {
        await this.storage.put(key, JSON.parse(JSON.stringify(txData.value)))
      }
      this.txPool.txs.delete(key)
    },
    getTxs: (valid = true, cleared = true) => {
      const results: ITx[] = []
      this.txPool.txs.forEach((value, key) => {
        if (value.valid === valid && value.cleared === cleared) {
          results.push({
            key: key,
            value: value.value
          })
        }
      })
      return results
    }
  }

  public accounts = {
    // TODO: should load the state from memory on startup

    // cleared balance
      // adjusted as a block is being applied and applies its txs
      // also adjusted as a block is being reverted (and all of its txs)
    // pending balance
      // adjusted when a new tx is validated 
      // cleared balances will eventually catch up to this 
      // should have some expiration time on a tx when it is removed from the tx pool 
    // pledge
      // only added as a block is being applied and applies its txs 
      // only removed if a block is rolled back (maybe do a tx diff first?)
      // should these expire?
    // contract
      // only added as a block is being applied and applies its txs
      // only removed if a block is rolled back (maybe do a tx diff first?)
      // should expire at some point (may have to check ttl on read)
    _accounts: new Map<string, IAccount>(),
    crreateAccount: (address: string) => {
      this.accounts._accounts.set(address, {
        balance: {
          cleared: 0,
          pending: 0
        },
        pledge: null,
        contracts: new Set()
      })
    },
    getAccount: (address: string) => {
      // get all account info for an address
      return this.accounts._accounts.get(address)
    },
    getActiveBalance: (address: string) => {
      // get the current credit balance for an address
      return this.accounts._accounts.get(address).balance.cleared
    },
    getPendingBalance: (address: string) => {
      // get the pending credit balance for an address
      return this.accounts._accounts.get(address).balance.pending
    },
    getPledge: (address: string) => {
      return this.accounts._accounts.get(address).pledge
    },
    getContract: (address: string) => {
      return this.accounts._accounts.get(address).contracts.values().next().value
      // const contractId = crypto.getHash(contractPublicKey)
      // if (this.contracts.has(contractId)) {
      //   return JSON.parse(JSON.stringify(this.contracts.get(contractId)))
      // } else {
      //   throw new Error('Cannot locate contract')
      // }
    },
    getOrCreateAccount: (address: string) => {
      let account: IAccount
      if (this.accounts._accounts.has(address)) {
        account = this.accounts.getAccount(address)
      } else {
        this.accounts.crreateAccount(address)
        account = this.accounts.getAccount(address)
      }
      return account
    },
    updateBalance: (address: string, update: number, type: 'pending' | 'cleared') => {
      // update a pending or cleared account credit balance

      const account = this.accounts.getOrCreateAccount(address)
      let newBalance: number

      if (type === 'pending') {
        newBalance = account.balance.pending += update
      } else if (type === 'cleared') {
        newBalance = account.balance.cleared += update
      }

      if (newBalance < 0 ) {
        throw new Error(`Cannot update ${type} account balance to negative value!`)
      }
      
      this.accounts._accounts.set(address, account)
    },
    addPledge: (address: string, pledge: IPledge) => {

    },
    expirePledge: (address: string) => {

    },
    addContract: (address: string, contract: IContract) => {

    },
    expireContract: (address: string, contractId: string) => {

    }
  }

  proofOfTime: NodeJS.Timeout
  isFarming = false
  hasLedger = false

  constructor(
    public storage: Storage,
    public wallet: Wallet,
  ) {
    super()

    // a new block has been created locally (genesis or subsequent )
    this.on('block', async (block: Block) => {
      // (1) called from bootstrap after proof of time is computed and block is built
      // (2) called from createBlock after proof of timee is computed and block is built
      // (3) called from onBlockReceived when a new block is validated via gossip

      // add the block to the blockpool (all tx should already be in txPool)
      await this.blockPool.addBlock(block, true, false)

      // apply the block in the blockPool (will apply all tx and add to chain)
      await this.blockPool.applyBlock(block.key)

      // apply each tx in the block to active accounts
      let farmerAdjustment = 0, nexusAdjustment = 0
      for (let txId of block.value.content.txSet) {
        const tx = await this.txPool.getTxRecord(txId)
        const { farmerPayment, nexusPayment } = await this.applyTx(tx, 'cleared')
        farmerAdjustment += farmerPayment
        nexusAdjustment += nexusPayment
      }

      this.accounts.updateBalance('nexus', nexusAdjustment, 'pending')
      this.accounts.updateBalance('nexus', nexusAdjustment, 'cleared')
      this.accounts.updateBalance(block.value.content.publicKey, farmerAdjustment, 'pending')
      this.accounts.updateBalance(block.value.content.publicKey, farmerAdjustment, 'cleared')

      this.blockPool.bestBlock = null

      // send to subspace.js for gossip?
      this.emit('applied-block', block)

      if (this.isFarming) {
        // start solving the next block challenge
        this.farmNextBlock(block)
      }
    })
  }

  public getHeight() {
    // get the current height of the chain
    return this.chain.length
  }

  public getLastBlock() {
    if (this.chain.length) {
      return this.chain.lastBlock
    } 
  }

  public getLastBlockId() {
    if (this.chain.length) {
      return this.chain.lastBlock.key
    } 
  }

  public getImmutableCost() {
    return this.getLastBlock().value.content.immutableCost
  }

  public getMutableCost() {
    return this.getLastBlock().value.content.mutableCost
  }

  public setBlockTime(blockTime: number) {
    BLOCK_IN_MS = blockTime
  }

  public static computeMutableCost(creditSupply: number, spaceAvailable: number) {
    // cost in credits for one byte of storage per ms 
    return creditSupply / (spaceAvailable * MIN_PLEDGE_INTERVAL)
  }

  public static computeImmutableCost(mutableCost: number, mutableReserved: number, immutableReserved: number) {
    // the product of the cost of mutable storage and the ratio between immutable and mutable space reserved
    let multiplier = 1
    if (mutableReserved) {
      const ratio = immutableReserved / mutableReserved
      if (ratio > .01) {
        multiplier = ratio * 100
      }
    }
    return mutableCost * multiplier
  }    

  public async computeHostPayment(uptime: number, spacePledged: number, interval: number, pledgeTxId: string) {
    // calculate the nexus payment for a host 
    let sum: number = 0, spaceRatio: number, mutablePayment: number, immutablePayment: number
    let blockId = this.getLastBlockId()
    
    // work backwards from payment block to funding block
    while (blockId !== pledgeTxId) {
      const blockValue:IBlockValue = JSON.parse( await this.storage.get(blockId))
      // blockValue.content = JSON.stringify(blockValue.content)
      const block = await Record.loadFromData({
        key: blockId,
        value: blockValue
      })
      // blockRecord.unpack(null)      
      spaceRatio = spacePledged / block.value.content.spacePledged
      mutablePayment = spaceRatio * block.value.content.mutableCost
      immutablePayment = spaceRatio * block.value.content.immutableCost
      sum += mutablePayment + immutablePayment
      blockId = block.value.content.previousBlock
    }

    const timeRatio = uptime / interval
    const payment = timeRatio * sum
    return payment
  }

  public async bootstrap(spacePledged = MIN_PLEDGE_SIZE, pledgeInterval = MIN_PLEDGE_INTERVAL): Promise<void> {
    // creates the genesis block to start the chain 
    // contains a genesis pledge tx, from the genesis host/farmer and the reward tx
    // next farmer will create a contract for this block based on CoS for this block 
    const profile = this.wallet.getProfile()

    const content: IBlockContent = {
      previousBlock: null,
      creditSupply: 0,
      spacePledged: 0,
      immutableReserved: 0,
      mutableReserved: 0,
      immutableCost: 0,
      mutableCost: 0,
      solution: null,
      proof: 0,
      publicKey: profile.publicKey,
      signature: null,
      txSet: new Set()
    }

    const pendingBlock = await Block.init(content)
    const challenge = crypto.getHash('genesis')
    this.proofOfTime = await this.solveBlockChallenge(pendingBlock, challenge)
  
    // create the geneiss pledge
    await this.createPledgeTx(
      this.wallet.profile.proof.id,
      spacePledged,
      pledgeInterval
    )

    this.once('block', () => {
      resolve()
    })
  }

  public async solveBlockChallenge(block: Block, previousBlockId: string): Promise<NodeJS.Timeout> {
    // called once a new block round starts, or once I start farming the chain for the last block (late)
    block.computeProofOfSpace(this.wallet.profile.proof.plot, previousBlockId)

    if (await this.isBestProofOfSpace(block)) {
      this.blockPool.bestBlock = block
      const timeDelay = block.getTimeDelay()

      // set a timer to wait for time delay to checking if soltuion is best
      const proofOfTime = setTimeout( async () => {
        if (await this.isBestProofOfSpace(block)) {
          // should have already been cancelled, but we will check again to be sure
          this.buildBlock(block)
        } else {
          // expire the old block (or delete)
          // have to cancel the timeout if a better solution is received 
        }
      }, timeDelay)
      return proofOfTime
    }
  }

  private async isBestProofOfSpace(proposedBlock: Block) {
    // check to see if a given solution is the best solution for the curernt challenge
    const lastBlock = this.chain.lastBlock
    const bestBlock = this.blockPool.bestBlock

    // (1) There is no best block or last block (genesis block)
    // (2) There is no best block but there is a last block (subsequent block)
    // (3) There is a best block but it references a different parent (fork)

    if (!bestBlock) {
        return true
    } 

    if (bestBlock.key === proposedBlock.key) {
      return true
    }

    // check to see if we are comparing the same roots 
    if (proposedBlock.value.content.previousBlock !== lastBlock.key || bestBlock.value.content.previousBlock !== lastBlock.key) {
      throw new Error('Cannot compare proofs of space, blocks do not reference the correct parent! (chain has forked')
    }

    const bestSolution = bestBlock.value.content.solution
    const proposedSolution = proposedBlock.value.content.solution
    const challenge = lastBlock.key
    const source = Buffer.from(challenge)
    const incumbent = Buffer.from(bestSolution)
    const challenger = Buffer.from(proposedSolution)
    const targets = [incumbent, challenger]
    const closest = getClosestIdByXor(source, targets)
    return challenger === closest
  }

  private async buildBlock(block: Block) {
    // TODO: get the cost of storage from the second to last block, to reflect the CoS at that time (for storage contract)

    const profile = this.wallet.getProfile()

    // get the timestamp for block and rewardTx
    const timeStamp = Date.now()
    block.value.createdAt = timeStamp

    // create the reward tx 
    let receiver: string
    if (block.value.content.previousBlock) {
      receiver = profile.publicKey
    } else {
      receiver = 'nexus'
    }
    const rewardTx = await this.createRewardTx(receiver, 100, timeStamp)
    block.value.content.txSet.add(rewardTx.key)

    // create the immutable storage contract for the last block, if not genesis
    if (this.chain.lastBlock) {
      const lastBlockData = this.chain.lastBlock
      const lastBlock = await Record.loadFromData(lastBlockData)

      // must iterate through all tx from the last block to include them in the contract 
      let blockSize = lastBlock.getSize()
      for(let txId of lastBlock.value.content.txSet) {
        const tx = await this.txPool.getTxRecord(txId)
        const txSize = await tx.getSize()
        blockSize += txSize
      }

      const contractTx = await this.createImmutableContractTx(
        'nexus', 
        blockSize,
        lastBlock.value.content.txSet
      )
      block.value.content.txSet.add(contractTx.key)
    }

    // add all valid tx's in the memory pool 
    const txs = await this.txPool.getTxs(true, false)
    for(let tx of txs) {
      block.addTx(tx)
    }

    this.txPool.addTx(rewardTx, true, false)
    await this.txPool.applyTx(rewardTx.key)

    // set the block constants 
    block.setMutableCost()
    block.setImmutableCost()

    // sign the block and get the signature 
    block.value.content.proof = this.wallet.profile.proof.size
    await block.cast(profile)
    this.emit('block', block)    
  }

  private async farmNextBlock(lastBlock: Block) {

    const profile = this.wallet.getProfile()

    // start with the old block
    const content: IBlockContent = {
      previousBlock: lastBlock.key,
      creditSupply: lastBlock.value.content.creditSupply,
      spacePledged: lastBlock.value.content.spacePledged,
      immutableReserved: lastBlock.value.content.immutableReserved,
      mutableReserved: lastBlock.value.content.mutableReserved,
      immutableCost: 0,
      mutableCost: 0,
      solution: null,
      proof: 0,
      publicKey: profile.publicKey,
      signature: null,
      txSet: new Set()
    }

    const pendingBlock = await Block.init(content)
    
    // compute the solution
    this.proofOfTime = await this.solveBlockChallenge(pendingBlock, lastBlock.key)  
  }

    // Receive a block
      // find parent
        // if head
          // validate block
          // apply block 
        // if fork
          // validate is better
          // roll back each block 
          // roll back each tx in each block

    // Receive a tx
      // check if you have the tx
      // validate the tx
      // add to tx pool
      // add to balances 

  // async onBlock(record: Record) {
  //   // called from core when a new block is received via gossip or when a pending block is retrieved 
  //   // validates the block and checks if best solution before adding to blocks
  //   // wait until the block interval expires before applying the block

  //   // is this a new block?
  //   if (this.validBlocks.includes(record.key) || this.invalidBlocks.includes(record.key) || this.chain.blockIds.has(record.key)) {
  //     return {
  //       valid: true,
  //       reason: 'already have block'
  //     }
  //   }

  //   // create the block
  //   const block = new Block(record.value.content)
  
  //   // fetch the last block header to compare    
  //   const previousBlockKey = this.chain.lastBlockId
  //   const previousBlockRecordValue = this.clearedBlocks.get(previousBlockKey)
  //   const previousBlock = {
  //     key: previousBlockKey,
  //     value: JSON.parse(JSON.stringify(previousBlockRecordValue.content))
  //   }

  //   // is the block valid?
  //   const blockTest = await block.isValid(record, previousBlock)
  //   if (!blockTest.valid) {
  //     this.invalidBlocks.push(record.key)
  //     return blockTest
  //   }

  //   // review the tx set for valid tx and validate block constants
  //   let spacePledged = previousBlock.value.spacePledged
  //   let immutableReserved = previousBlock.value.immutableReserved 
  //   let mutableReserved = previousBlock.value.mutableReserved
  //   let hostCount = previousBlock.value.hostCount

  //   // later, validate there is only one reward tx and one block storage tx per block

  //   for (const txId of block.value.txSet) {
  //     // check if in the memPool map
  //     if (! this.validTxs.has(txId)) {
  //       // if not in mempool check if it is invalid set
  //       if (this.invalidTxs.has(txId)) {
  //         this.invalidBlocks.push(record.key)
  //         return {
  //           valid: false,
  //           reason: 'Invalid block, block contains an invalid tx'
  //         }
  //       } else {
  //         // how can we request the tx from a parent module?
            


  //         // throw error for now, later request the tx, then validate the tx
  //         console.log('Missing tx is: ', txId)
  //         return {
  //           valid: false,
  //           reason: 'Tx in proposed block is not in the mem pool'
  //         }
  //       }
  //     }

  //     const recordValue = this.validTxs.get(txId)
  //     const tx = JSON.parse(JSON.stringify(recordValue.content))
  //     if (tx.type === 'pledge') {  
  //       // if pledge, modify spaceAvailable, add to host count 
  //       spacePledged += tx.spacePledged
  //       hostCount += 1
  //     } else if (tx.type === 'contract') {  
  //       // if contract, modify space reserved
  //       if (tx.ttl) {
  //         mutableReserved += tx.spaceReserved
  //       } else {
  //         immutableReserved += tx.spaceReserved
  //       }
  //     } 
  //   }

  //   // recalculate available space and costs
  //   const creditSupply = previousBlock.value.creditSupply + block.value.reward
  //   const spaceAvailable = spacePledged - mutableReserved - immutableReserved
  //   const mutableCost = this.computeMutableCost(creditSupply, spaceAvailable)
  //   const immutableCost = this.computeImmutableCost(mutableCost, mutableReserved, immutableReserved)
    
  //   // are the block constants calculated correctly?
  //   if ((spacePledged !== block.value.spacePledged ||
  //       immutableReserved !== block.value.immutableReserved ||
  //       mutableReserved !== block.value.mutableReserved ||
  //       immutableCost !== block.value.immutableCost ||
  //       mutableCost !== block.value.mutableCost ||
  //       hostCount !== block.value.hostCount ||
  //       creditSupply !== block.value.creditSupply
  //   )) {
  //     this.invalidBlocks.push(record.key)
  //     return {
  //       valid: false,
  //       reason: 'Invalid block, block constants are not correct'
  //     }
  //   }

  //   // is it the best solution proposed?
  //   if (this.isBestProofOfSpace(block.value.solution)) {
  //     this.validBlocks.unshift(record.key)
  //     this.pendingBlocks.set(record.key, JSON.parse(JSON.stringify(record.value)))
  //     clearTimeout(this.delay)
  //   } else {
  //     this.validBlocks.push(record.key)
  //   }

  //   blockTest.valid = true 
  //   return blockTest
  // }

  // async onTx(tx: Tx) {
  //   // called from core when a new tx is recieved via gossip
  //   // validates the tx and adds to mempool updating the pending UTXO balances

  //   // for tx's received over the network
  //   if (this.txPool.txs.has(tx.key)) {
  //     return {
  //       valid: true,
  //       reason: 'already have tx'
  //     }
  //   }

  //   // validate the tx
  //   const tx = new Tx(record.value.content)
  //   let senderBalance: number = null
  //   if (tx.value.sender) {
  //     senderBalance = this.getBalance(crypto.getHash(tx.value.sender))
  //   }
  //   const lastBlock = await this.blockPool.getBlock(this.chain.lastBlockId)
  //   const txTest = await tx.isValid(record.getSize(), lastBlock.value.content.immutableCost, lastBlock.value.content.mutableCost, senderBalance, lastBlock.value.content.hostCount)

  //   // ensure extras storage contracts are not being created
  //   if (tx.value.type === 'contract' && tx.value.sender === NEXUS_ADDRESS) {
  //     throw new Error('Invalid tx, block storage contracts are not gossiped')
  //   }

  //   if (!txTest.valid) {
  //     this.txPool.addTx(record, false, false)
  //     return txTest
  //   }

  //   await this.applyTx(tx, record)
    
  //   this.txPool.addTx(record, true, false)

  //   txTest.valid = true
  //   return txTest
  // }

  async onTxCreated(tx: Tx) {
    // called after a new tx is generated locally

    this.txPool.addTx(tx, true, false)
    await this.applyTx(tx, 'pending')
    this.emit('tx', Tx)
  }

  async onTxReceived(txData: ITx) {
    // called after a new tx is received over the network 

    // confirm I don't already have the tx
    // load the tx
    // validate the tx
    // add tx to the txPool: valid, not cleared
    // apply to pending balances 

    // return if to gossip back out to the network 
  }

  async applyTx(tx: Tx, type: 'pending' | 'cleared') {
    // called when a new tx is applied to pending balances, but yet in a block
    const profile = this.wallet.getProfile()
    let farmerPayment = 0, nexusPayment = 0
    switch(tx.value.content.type) {
      case('reward'): {
        // credit the farmer 
        
        this.accounts.updateBalance(tx.getReceiverAddress(), tx.value.content.amount, type)

        // tx fees are a wash
          // nexus account pays the cost of storage
          // nexus account receives the cost of storage
          // no farmer fees are applied to the reward tx
        break     
      }

      case('credit'): {
        // credit the recipient
        const receiver = tx.getReceiverAddress()
        const credit = tx.value.content.amount
        this.accounts.updateBalance(receiver, credit, type)

        // debit the sender
        const sender = tx.getSenderAddress()
        const debit = -(credit + tx.value.content.cost)
        this.accounts.updateBalance(sender, debit, type)

        if (type === 'cleared') {
          // seperate tx fees
          const storageCost = tx.getCostofStorage(this.getImmutableCost())
          farmerPayment = tx.value.content.cost - storageCost
          nexusPayment = storageCost
        }

        // nexus gets paid the cost of storage (CoS)
        // farmer gets paid the tx fee -- Cost less CoS
        break
      }

      case('pledge'): {
        if (type === 'cleared') {
          const pledge: IPledge = {
            txId: tx.key,
            size: tx.value.content.spacePledged,
            interval: tx.value.content.pledgeInterval,
            proof: tx.value.content.pledgeProof,
            createdAt: tx.value.createdAt
          }

          // add the pledge to sender account
          const sender = tx.getSenderAddress()
          this.accounts.addPledge(sender, pledge) 

          // nexus pays the cost of storage and tx fees (within limit)
          // farmer gets paid the tx fee
          // host will have the cost (fees + CoS) dedcuted from their first payment and paid to the farmer 

          const storageCost = tx.getCostofStorage(this.getImmutableCost())
          farmerPayment = tx.value.content.cost - storageCost
          nexusPayment = -tx.value.content.cost
        }
        break
      }

      case('contract'): {
        // sender pays all fees
        const sender = tx.getSenderAddress()
        const debit = -(tx.value.content.amount + tx.value.content.cost)
        this.accounts.updateBalance(sender, debit, type)

        if (type === 'cleared') {
          const contract = {
            txId: tx.key,
            createdAt: tx.value.createdAt,
            spaceReserved: tx.value.content.spaceReserved,
            replicationFactor: tx.value.content.replicationFactor,
            ttl: tx.value.content.ttl,
            contractSig: tx.value.content.contractSig,
            contractId: tx.value.content.contractId
          }
          this.accounts.addContract(sender, contract)

          const storageCost = tx.getCostofStorage(this.getImmutableCost())
          farmerPayment = tx.value.content.cost - storageCost
          nexusPayment = tx.value.content.amout + storageCost
        }
        // have to ensure the farmer does not apply a tx fee to the block storage payment 
        // why are record.key and tx.value.contractId not the same?
          // immutable vs mutable contracts ... 
          // goes back to original dilemma, if immutable contracts can have mutable state
          // this would work for block storage, as they could be organized around shards as well
            // each block, farmer would check size of leder storage contract
              // if space avaiable then add the block header and txs to appropriate shard
              // if not, then create a new immutalbe storage contract, paid for by the nexus
              // nexus of course needs some starting credits to pay out of (must be inlcuded in credit supply)
            // the contract holders would not store anything unless the block was valid
            // and the contract state would be append only, but still a mutable record
        break
      }

      case('nexus'): {
        // credit the sender the nexus payment, subtracting the tx cost
        const sender = tx.getSenderAddress()
        const credit = tx.value.content.amount - tx.value.content.amount
        this.accounts.updateBalance(sender, credit, type)

        if (type === 'cleared') {
          // farmer gets the tx fee
          // debit the nexus the host payment, but deduct the cost of storage
          const storageCost = tx.getCostofStorage(this.getImmutableCost())
          farmerPayment = tx.value.content.cost - storageCost
          nexusPayment = storageCost - tx.value.content.amount 
        }
        break
      }

      default: {
        throw new Error('Invalid tx type cannot be applied to pending balance')
      }
    }
    return {farmerPayment, nexusPayment}
  }

  async revertTx() {
    // called when a tx is rolled back because the parent block has been rolled back

  }

  async onBlockCreated(block: Block) {
    // called after a new block is generated locally

  }

  async onBlockReceived(blockData: IBlock) {
    // called after a new block is received over the network 

  }

  async revertBlock() {

  }

  

  public async createRewardTx(receiver: string, amount: number, timestamp: number) {
    const tx = await Tx.createRewardTx(
      receiver,
      amount,
      this.getImmutableCost(),
      timestamp
    )

    return tx
  }
  
  public async createCreditTx(sender: string, receiver: string, amount: number) {

    const profile = this.wallet.getProfile()
    const tx = await Tx.createCreditTx(
      sender,
      receiver, 
      amount, 
      this.getImmutableCost(), 
      profile
    )

    // check to make sure you have the funds available
    if (tx.value.content.cost > this.accounts.getPendingBalance(profile.id)) {
      throw new Error('insufficient funds for tx')
    }

    await this.onTxCreated(tx)
    return tx
  }

  public async createPledgeTx(proof: string, size: number, interval = MIN_PLEDGE_INTERVAL) {
    // creates a pledge tx instance and calculates the fee

    const tx = await Tx.createPledgeTx(
      proof, 
      size, 
      interval, 
      this.getImmutableCost(),
      this.wallet.getProfile()
    )

    this.wallet.profile.pledge = {
      proof,
      size,
      interval, 
      createdAt: tx.value.createdAt,
      pledgeTx: tx.key
    }

    await this.onTxCreated(tx)
    return tx
  }

  public async createNexusTx(pledgeTx: string, amount: number) {
    // creates a nexus to host payment tx instance and calculates the fee
    const tx = await Tx.createNexusTx(
      amount, 
      pledgeTx, 
      this.getImmutableCost(),
      this.wallet.getProfile()
    )

    await this.onTxCreated(tx)
    return tx
  }

  public async createImmutableContractTx(sender: string, spaceReserved: number, records: Set <string>) {
    // reserve a fixed amount of immutable storage on SSDB with known records
    const immutableCost = this.getImmutableCost()
    const cost = spaceReserved * immutableCost
    const tx = await Tx.createImmutableContractTx(
      sender, 
      cost, 
      spaceReserved, 
      records, 
      immutableCost, 
      this.wallet.getProfile()
    )
  
    // check to make sure you have the funds available 
    if (tx.value.content.cost > this.accounts.getPendingBalance(sender)) {
      throw new Error('Insufficient funds for tx')
    }

    await this.onTxCreated(tx)
    return tx
  }

  public async createMutableContractTx(spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string) {
    // reserve space on SSDB with a mutable storage contract
    // have to create or pass in the keys

    const profile = this.wallet.getProfile()
    const tx = await Tx.createMutableContractTx(
      spaceReserved, 
      replicationFactor, 
      ttl, 
      contractSig, 
      contractId, 
      this.getImmutableCost(),
      profile
    )

    // check to make sure you have the funds available 
    if (tx.value.content.cost > this.accounts.getPendingBalance(profile.id)) {
      throw new Error('insufficient funds for tx')
    }

    await this.onTxCreated(tx)
    return tx
  } 
}
 
export class Block extends ImmutableRecord implements IBlock {

  constructor() {
    super()
  }

  // static methods

  static async init(content: IBlockContent) {
    const block = new Block()
    await block.init(content, false, false)
    block.value.type = 'immutable'
    return block
  }

  public async cast(profile: IProfileObject) {
    // TODO: handle orphaned reward txs in the mem pool 
      // don't apply reward tx to the tx pool until you cast the block 

    this.sign(profile.privateKeyObject)
    await this.pack(null)
    this.setKey()
    await this.unpack(null)
    return this
  }

  // public methods

  public addTx(tx: ITx) {
    switch(tx.value.content.type) {
      case('reward'): {
        this._value.content.creditSupply += tx.value.content.amount
        break
      }

      case('pledge'): {
        this._value.content.spacePledged += tx.value.content.spacePledged
        break
      }

      case('contract'): {
        if (tx.value.content.ttl) {
          this._value.content.mutableReserved += tx.value.content.spaceReserved
        } else {
          this._value.content.immutableReserved += tx.value.content.spaceReserved
        }
        break
      }

      default: {
        break
      }
    }
    this.value.content.txSet.add(tx.key)
  }

  public setMutableCost() {
    const spaceAvailable = this.value.content.spacePledged - this.value.content.immutableReserved - this.value.content.mutableReserved
    this._value.content.mutableCost = Ledger.computeMutableCost(this.value.content.creditSupply, spaceAvailable)
  }

  public setImmutableCost() {
    this._value.content.immutableCost = Ledger.computeImmutableCost(this.value.content.mutableCost, this.value.content.mutableReserved, this.value.content.immutableReserved)
  }

  public async isValidGenesisBlock(block: Block) {
    let response = {
      valid: false,
      reason: <string> null
    }

    // // does it have height 0 
    // if (this._value.height !== 0) {
    //   response.reason = 'invalid genesis block, wrong block height'
    //   return response
    // }

    // is the record size under 1 MB
    if (block.getSize() > 1000000) {
      response.reason = 'invalid genesis block, block is larger than one megabyte'
      return response
    }

    // does it have null solution 
    if (this._value.content.solution) {
      response.reason = 'invalid genesis block, should not have a solution'
      return response
    }

    // has space been pledged
    if (!this._value.content.spacePledged) {
      response.reason = 'invalid genesis block, no space has been pledged'
      return response
    }

    // has space been reserved
    if (this._value.content.immutableReserved || this._value.content.mutableReserved) {
      response.reason = 'invalid genesis block, should not have any space reserved'
      return response
    }

    // is credit supply right
    if (this._value.content.creditSupply !== 100) {
      response.reason = 'invalid genesis block, wrong initial credit supply'
      return response
    }

    // are there two txs
    this._value.content.txSet = new Set(this._value.content.txSet)
    if (this._value.content.txSet.size !== 1) {
      response.reason = 'invalid genesis block, can only have two tx'
      return response
    }

    // does pledge equals spacePledged
    if (this._value.content.spacePledged !== this._value.content.pledge) {
      response.reason = 'invalid genesis block, pledge is not equal to space pledged'
      return response
    }

    // correct mutable cost
    const mutableCost = Ledger.computeMutableCost(this._value.content.creditSupply, this._value.content.spacePledged)
    if (this._value.content.mutableCost !== mutableCost) {
      response.reason = 'invalid genesis block, invalid mutable cost of storage'
      return response
    }
    
    // correct immutable cost
    const immutableCost = Ledger.computeImmutableCost(this._value.content.mutableCost, this._value.content.mutableReserved, this._value.content.immutableReserved)
    if (this._value.content.immutableCost !== immutableCost) {
      response.reason = 'invalid genesis block, invalid immutable cost of storage'
      return response
    }


    // does it have a valid reward tx 

    // does it have a valid pledge tx 


    // is the signature valid 
    if (! await this.isValidSignature()) {
      response.reason = 'invalid genesis block, invalid block signature'
      return response
    }

    response.valid = true
    return response
  }

  public async isValidBlock(newBlock: Block, previousBlock: {key: string, value: Block['value']}) {
    // check if the block is valid

    let response = {
      valid: false,
      reason: <string> null
    }
    
    // is it at the correct height?
    // if (this._value.height !== (previousBlock.value.height + 1)) {
    //   response.reason = 'invalid block, wrong block height'
    //   return response
    // }

    // does it reference the correct last block?
    if (this._value.content.previousBlock !== previousBlock.key) {
      response.reason = 'invalid block, references incorrect parent block'
      return response
    }

    // is the record size under 1 MB
    if (newBlock.getSize() > 1000000) {
      response.reason = 'invalid block, block is larger than one megabyte'
      return response
    }

    // is the solution valid?
    if (! this.isValidProofOfSpace(newBlock.value.content.publicKey, newBlock.value.content.previousBlock)) {
      response.reason = 'invalid block, solution is invalid'
      return response
    }

    // is reward amount correct?
    if (this._value.content.reward !== 100) {
      response.reason = 'invalid block, invalid reward tx'
      return response
    }

    // is the delay valid?
    // replace by checking the timestamp of last block plus delay
    // if (! this.isValidTimeDelay()) {
    //   response.reason = 'invalid block, time delay is invalid'
    //   return response
    // }

    // did they wait long enough before publishing the block? Later

    // is the signature valid
    if (! await this.isValidSignature()) {
      response.reason = 'invalid block, invalid block signature'
      return response
    }
 
    // // is the reward tx enclosed in a valid immutable record?
    // const rewardData = newBlock.value.content.reward
    // const rewardRecord = new Record(rewardData.key, rewardData.value) 
    // const recordRewardTest = await rewardRecord.isValid()
    // if (!recordRewardTest.valid) {
    //   response.reason = 'invalid block, invalid record for reward tx'
    //   return response
    // }

    // // is the reward tx a valid tx?
    // const rewardTx = new Tx(rewardData.value.content)
    // const rewardTxTest = await rewardTx.isValid(rewardRecord.getSize(), previousBlock.value.immutableCost)
    // if (!rewardTxTest.valid) {
    //   response.reason = 'invalid block, invalid reward tx'
    //   return response
    // }

    // // is the storage contract tx enclosed in a valid immutable record?
    // const contractData = newBlock.value.content.contract
    // const contractRecord = new Record(contractData.key, contractData.value) 
    // const contractRecordTest = await contractRecord.isValid()
    // if (!contractRecordTest.valid) {
    //   response.reason = 'invalid block, invalid record for contract tx'
    //   return response
    // }

    // // is the storage contract tx a valid tx?
    // const contractTx = new Tx(contractData.value.content)
    // const contractTxTest = await contractTx.isValid(contractRecord.getSize(), previousBlock.value.immutableCost, previousBlock.value.mutableCost, null, previousBlock.value.hostCount)
    // if (!contractTxTest.valid) {
    //   response.reason = 'invalid block, invalid contract tx'
    //   return response
    // }
      
    response.valid = true
    return response
  }

  public computeProofOfSpace(plot: Set<string>, previousBlock: string) {
    // searches a plot for the best solution to the block challenge
    const bufferPlot = [...plot].map(solution => Buffer.from(solution))
    const bufferChallnege = Buffer.from(previousBlock)
    const bufferSoltuion = getClosestIdByXor(bufferChallnege, bufferPlot)
    const solution = bufferSoltuion.toString()
    this._value.content.solution = solution
    return solution
  }

  public isValidProofOfSpace(publicKey: string, previousBlock: string) {
    // check if the included block solution is the best for the last block
    const seed = crypto.getHash(publicKey)
    const proof = crypto.createProofOfSpace(seed, this._value.content.pledge)
    return this._value.content.solution === this.computeProofOfSpace(proof.plot, previousBlock)
  }

  public computeHamming(src: string, dst: string) {
  
    if (src.length !== dst.length) {
      return null
    }

    var i = src.length
    var sum = 0

    while (i--) {
      if (src[i] !== dst[i]) {
        sum++
      }
    }

    return sum
  }

  public getTimeDelay(seed: string = this._value.content.solution) {
    // computes the time delay for my solution, later a real VDF
    const delay = crypto.createProofOfTime(seed)
    const difficulty = this.computeHamming(this._value.content.previousBlock, this._value.content.solution)
    const adjustment = 1 - (difficulty / 64)
    const adjustedDelay = delay * adjustment
    const maxDelay = 1024000
    return Math.floor((adjustedDelay / maxDelay) * (BLOCK_IN_MS))
  }

  public async sign(privateKeyObject: any) {
    // signs the block
    this._value.content.signature = await crypto.sign(this._value, privateKeyObject)
  }

  public async isValidSignature() {
    const unsignedBlock = JSON.parse(JSON.stringify(this._value))
    unsignedBlock.signature = null
    return await crypto.isValidSignature(unsignedBlock, this._value.content.signature, this._value.content.publicKey)
  }

  // private methods
}

export class Tx extends ImmutableRecord implements ITx {  
  constructor() {
    super()
  }

  // static methods

  static async createRewardTx(receiver: string, amount: number, immutableCost: number, timestamp: number) {
    const rewardTx = new Tx()
    const content: IRewardTxContent = {
      type: 'reward',
      sender: null,
      receiver,
      amount,
      cost: null,
      signature: null
    }

    await rewardTx.init(content, false, true)
    rewardTx.value.createdAt = timestamp
    await rewardTx.pack(null)
    rewardTx.setKey()
    const costOfStorage = rewardTx.getCostofStorage(immutableCost)
    await rewardTx.unpack(null)
    rewardTx.setTxCost(costOfStorage, 1)
    await rewardTx.pack(null)
    rewardTx.setKey()
    await rewardTx.unpack(null)
    return rewardTx
  }

  static async createCreditTx(sender: string, receiver: string, amount: number, immutableCost: number, profile: IProfileObject) {
    // create and return a new credit tx, sends credits between two addresses

    const creditTx = new Tx()
    const content: ICreditTxContent = {
      type: 'credit',
      sender,
      receiver,
      amount,
      cost: null,
      signature: null
    }

    return await creditTx.cast(content, profile, immutableCost)
  }

  static async createPledgeTx(proof: string, spacePledged: number, interval: number, immutableCost: number, profile: IProfileObject) {
    // create a new host pledge tx

    const pledgeTx = new Tx()
    const content: IPledgeTxContent = {
      type: 'pledge',
      sender: profile.publicKey,
      receiver: 'nexus',
      amount: 0,
      cost: null,
      pledgeProof: proof,
      spacePledged: spacePledged,
      pledgeInterval: interval,
      seed: profile.publicKey,
      signature: null
    }

    return await pledgeTx.cast(content, profile, immutableCost)
  }

  static async createNexusTx(amount: number, pledgeTx: string, immutableCost: number, profile: IProfileObject) {
    // create a host payment request tx
    // needs to be signed by the host so it may not be submitted on their behalf

    const nexusTx = new Tx()
    const content: INexusTxContent = {
      type: 'nexus',
      sender: 'nexus',
      receiver: profile.publicKey,
      amount,
      cost: null,
      pledgeTx,
      signature: null
    }

    return await nexusTx.cast(content, profile, immutableCost)
  }

  static async createImmutableContractTx(sender: string, cost: number, spaceReserved: number, records: Set<string>, immutableCost: number, profile: IProfileObject) {
    // create a new contract tx to store immutable data

    const contractTx = new Tx()
    const content: IContractTxContent = {
      type: 'contract',
      sender,
      receiver: 'nexus',
      amount: cost,
      cost: 0,
      spaceReserved,
      ttl: 0,
      replicationFactor: 0,
      recordIndex: records,
      contractSig: null,
      contractId: null,
      signature: null
    }

    return await contractTx.cast(content, profile, immutableCost)
  }

  static async createMutableContractTx(spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string, immutableCost: number, profile: IProfileObject) {

    const contractTx = new Tx()
    const content: IContractTxContent = {
      type: 'contract',
      sender: profile.publicKey,
      receiver: 'nexus',
      amount: immutableCost * spaceReserved * replicationFactor * ttl,
      cost: null,
      spaceReserved,
      ttl,
      replicationFactor,
      contractSig,
      contractId,
      signature: null
    }

    return await contractTx.cast(content, profile, immutableCost)
  }

  static async loadTxFromData(txData: ITx) {
    const tx = new Tx()
    tx.key = txData.key
    tx.value = txData.value
    return tx
  }

  protected async cast(content: ITxContent, profile: IProfileObject, immutableCost: number) {
    this.init(content, false, true)
    await this.sign(profile.privateKeyObject)
    await this.pack(null)
    this.setKey()
    const costOfStorage = this.getCostofStorage(immutableCost)
    await this.unpack(null)
    this.setTxCost(costOfStorage, 2)
    await this.sign(profile.privateKeyObject)
    await this.pack(null)
    this.setKey()
    await this.unpack(null)
    return this
  }

  // public methods
  public async isValidTx(size: number, immutableCost: number, mutableCost?: number, senderBalance?: number, hostCount?: number) {
    let response = {
      valid: false,
      reason: <string> null
    }

    // tx fee is correct
    if (!(this._value.content.cost >= size * immutableCost)) {
      if (this.value.content.type !== 'contract') {
        response.reason = 'invalid tx, tx fee is too small'
        return response
      }
    }

    // address has funds
    if (this._value.content.sender !== NEXUS_ADDRESS && this._value.content.sender) {
      if ((this._value.content.amount + this._value.content.cost) >= senderBalance) {
        response.reason = 'invalid tx, insufficient funds in address'
        return response
      }
    }

    // has valid signature
    if (['contract', 'pledge', 'credit'].includes(this._value.type)) {
      if (this._value.content.receiver !== NEXUS_ADDRESS) {
        if (! await this.isValidSignature()) {
          response.reason = 'invalid tx, invalid signature'
          return response
        }
      }
    }
    
    // special validation 
    switch(this._value.content.type) {
      case('pledge'): 
        response = this.isValidPledgeTx(response)
        break
      case('contract'):
        response = await this.isValidContractTx(response, hostCount, mutableCost, immutableCost)
        break
      case('nexus'): 
        response = this.isValidNexusTx(response)
        break
      // case('reward'): 
      //   response = this.isValidRewardTx(response)
      //   break
      case('credit'):
        break
      default: 
        throw new Error('invalid tx type, cannot validate')
    }
    response.valid = true
    return response
  }

  public isValidPledgeTx(response: any) {
    // validate pledge (proof of space)
    if (! crypto.isValidProofOfSpace(this._value.content.sender, this.value.content.spacePledged, this._value.content.pledgeProof)) {
      response.reason = 'invalid pledge tx, incorrect proof of space'
      return response
    }

    // size within range 10 GB to 1 TB
    if (!(this._value.content.spacePledged >= MIN_PLEDGE_SIZE || this._value.content.spacePledged <= MAX_PLEDGE_SIZE)) {
      response.reason = 'invalid pledge tx, pledge size out of range'
      return response
    }

    // payment interval within range one month to one year (ms)
    if (!(this._value.content.pledgeInterval >= MONTH_IN_MS || this._value.content.pledgeInterval <= YEAR_IN_MS)) {
      response.reason = 'invalid pledge tx, pledge interval out of range'
      return response
    }

    // should not have an active or pending pledge (later)

    response.valid = true
    return response
  }

  public async isValidContractTx(response: any, hostCount: number, mutableCost: number, immutableCost: number) {
    if (this._value.content.ttl) {  // mutable storage contract
    
      // validate TTL within range
      if (!(this._value.content.ttl >= HOUR_IN_MS || this._value.content.ttl <= YEAR_IN_MS)) {
        response.reason = 'invalid contract tx, ttl out of range'
        return response
      }

      // validate replicas within range
      if (!(this._value.content.replicationFactor >= 1 || this._value.content.replicationFactor <= Math.log2(hostCount))) {
        response.reason = 'invalid contract tx, replicas out of range'
        return response
      }

      // validate size within range
      if (!(this._value.content.spaceReserved >= MIN_MUTABLE_CONTRACT_SIZE || this._value.content.spaceReserved <= MAX_MUTABLE_CONTRACT_SIZE)) {
        response.reason = 'invalid contract tx, mutable space reserved out of range'
        return response
      }

      // validate the cost 
      if (this._value.content.amount !== (mutableCost * this._value.content.spaceReserved * this._value.content.replicationFactor * this.value.content.ttl)) {
        response.reason = 'invalid contract tx, incorrect cost of mutable space reserved'
        return response
      }

      // validate contract signature 
      // const txData = { ...this._value }
      // txData.contractSig = null

      // if (!(await crypto.isValidSignature(txData, this._value.contractSig, this._value.contractKey))) {
      //   response.reason = 'invalid contract tx, incorrect contract signature'
      //   return response
      // }

      // should only be able to make one mutable contract per block, later

    } else {  // immutable storage contract

      // validate size within range
      if (!(this._value.content.spaceReserved >= MIN_IMMUTABLE_CONTRACT_SIZE || this._value.content.spaceReserved <= MAX_IMMUTABLE_CONTRACT_SIZE)) {
        response.reason = 'invalid contract tx, immutable space reserved out of range'
        return response
      }

      // validate the cost
      if (this._value.content.amount !== (immutableCost * this._value.content.spaceReserved * this._value.content.replicationFactor)) {
        response.reason = 'invalid contract tx, incorrect cost of immutable space reserved'
        return response
      }

      // should only be able to make one immutable contract per block, later 
    }

    return response
  }

  public isValidNexusTx(response: any) {
    // does sender = nexus
    if (this._value.content.sender !== NEXUS_ADDRESS) {
      response.reason = 'invalid nexus tx, nexus address is not the recipient'
      return response
    }

    // does the recipient have a host contract? Later ..
    // if(contract) {
    //   valid.reason = 'invalid nexus tx, host does not have a valid pledge'
    //   return valid
    // }

    // is the payment amount valid (later)

    // should only be able to submit one nexus payment request per block later 
    
    response.valid = true
    return response
  }

  // get the cost of storage (based on tx size)
    // get the size of the JSON record 
    // add the default size value for 64k 64,000,000

  // set the fee for the farmer 

  public getCostofStorage(immutableCost: number) {
    // we have to carefully extrapolate the size since fee is based on size
    // we know the base record size and that each integer for amount and fee is one byte
    // also have to add in a small buffer that 
      // provides an incentive to farmers to include the tx (they keep the difference)
      // handle variability in the cost of storage, if tx does not immediatlely get into the next block, since the cost of storage may be greater in the following block/s, which it will be validated against

    // convert JSON to string and add 8 bytes for the size integer
    // multiply by the cost of immutable storage to determine the base cost
    return (this.getSize() + 8) * immutableCost
  }

  public getReceiverAddress() {
    return crypto.getHash(this.value.content.receiver) 
  }

  public getSenderAddress() {
    return crypto.getHash(this.value.content.sender)
  }

  public async isValidSignature() {
    const unsignedTx = JSON.parse(JSON.stringify(this._value))
    unsignedTx.signature = null
    return await crypto.isValidSignature(unsignedTx, this._value.content.signature, this._value.content.sender)
  } 

  // private methods
  private setTxCost(costOfStorage: number, incentiveMultiplier: number) {
    // add a fee for the farmer (currently 1.5)
    this.value.content.cost = costOfStorage * incentiveMultiplier
  }

  private async sign(privateKeyObject: any) {
    this.value.content.signature = await crypto.sign(this._value, privateKeyObject)
  }
}

