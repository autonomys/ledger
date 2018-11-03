import {IPledge, IContract} from './interfaces'
import * as crypto from '@subspace/crypto'
import { getClosestIdByXor } from '@subspace/utils'
import { Record, IValue } from '@subspace/database'
import { EventEmitter } from 'events'

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
const BLOCK_IN_MS = 600000               // 10 minutes in ms
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
const BASE_CREDIT_TX_RECORD_SIZE = 1245   // size of each tx type as full SSDB record in bytes, with null values for variable fields
const BASE_PLEDGE_TX_RECORD_SIZE = 741
const BASE_CONTRACT_TX_RECORD_SIZE = 2281
const BASE_NEXUS_TX_RECORD_SIZE = 409
const BASE_REWARD_TX_RECORD_SIZE = 402
const NEXUS_ADDRESS = crypto.getHash('nexus')
const FARMER_ADDRESS = crypto.getHash('farmer')
const TX_FEE_MULTIPLIER = 1.02

export class Ledger extends EventEmitter {
  chain: string[] = []
  validBlocks: string[] = []
  pendingBlocks: Map <string, IValue> = new Map()
  clearedBlocks: Map <string, IValue> = new Map()
  invalidBlocks: string[] = []
  validTxs: Map<string, IValue> = new Map()
  invalidTxs: Set<string> = new Set()

  // the UTXO as of the last block 
  clearedBalances: Map <string, number> = new Map()
  clearedPledges: Map <string, IPledge> = new Map()
  clearedContracts: Map <string, IContract> = new Map()
  
  // the UTXO with all valid tx in mempool applied
  pendingBalances: Map <string, number> = new Map()
  pendingPledges: Map <string, IPledge> = new Map()
  pendingContracts: Map <string, IContract> = new Map()

  // stats as of the last block   
  clearedSpacePledged: number = 0
  clearedMutableReserved: number = 0
  clearedImmutableReserved: number = 0
  clearedSpaceAvailable: number = 0
  clearedHostCount: number = 0
  clearedCreditSupply: number = 0
  clearedMutableCost: number = 0
  clearedImmutableCost: number = 0

  // stats with all valid tx in mempool applied
  pendingSpacePledged: number 
  pendingMutableReserved: number 
  pendingImmutableReserved: number 
  pendingSpaceAvailable: number 
  pendingHostCount: number
  pendingCreditSupply: number 
  pendingMutableCost: number 
  pendingImmutableCost: number 

  isFarming = false
  hasLedger = false

  constructor(
    public storage: any,
    public wallet: any,
  ) {
    super()
    this.clearedBalances.set(NEXUS_ADDRESS, 10000)
    this.clearedBalances.set(FARMER_ADDRESS, 0)
  }

  public static getMutableCost(creditSupply: number, spaceAvailable: number) {
    const ledger = new Ledger(null, null)
    return ledger.computeMutableCost(creditSupply, spaceAvailable)
  }

  public static getImmutableCost(mutableCost: number, mutableReserved: number, immutableReserved: number) {
    const ledger = new Ledger(null, null)
    return ledger.computeImmutableCost(mutableCost, mutableReserved, immutableReserved)
  }

  public computeMutableCost(creditSupply: number, spaceAvailable: number) {
    // cost in credits for one byte of storage per ms 
    return creditSupply / (spaceAvailable * MIN_PLEDGE_INTERVAL)
  }

  public computeImmutableCost(mutableCost: number, mutableReserved: number, immutableReserved: number) {
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
      const blockValue = JSON.parse( await this.storage.get(blockId))
      const blockRecord = Record.readPacked(blockId, blockValue)
      blockRecord.unpack(null)      
      spaceRatio = spacePledged / blockRecord.value.content.spacePledged
      mutablePayment = spaceRatio * blockRecord.value.content.mutableCost
      immutablePayment = spaceRatio * blockRecord.value.content.immutableCost
      sum += mutablePayment + immutablePayment
      blockId = blockRecord.value.content.previousBlock
    }

    const timeRatio = uptime / interval
    const payment = timeRatio * sum
    return payment
  }

  private isBestBlockSolution(solution: string) {
    // check to see if a given solution is the best solution for the curernt challenge
    const challenge = this.chain[this.chain.length - 1]
    const bestSolution = this.validBlocks[0]
    if (!bestSolution) {
      return true
    }
    const source = Buffer.from(challenge)
    const contender = Buffer.from(bestSolution)
    const challenger = Buffer.from(solution)
    const targets = [contender, challenger]
    const closest = getClosestIdByXor(source, targets)
    return contender === closest
  }

  public getBalance(address: string) {
    // get the current UTXO balance for an address
    return this.pendingBalances.get(address)
  }

  public getHeight() {
    // get the current height of the chain
    return this.chain.length
  }

  public getLastBlockId() {
    if (this.chain.length) {
      return this.chain[this.chain.length - 1]
    } 
  }

  public async bootstrap(spacePledged = MIN_PLEDGE_SIZE, pledgeInterval = MIN_PLEDGE_INTERVAL) {
    // creates the genesis block to start the chain 
    // contains the reward tx and a single pledge tx, from the genesis host/farmer
    // does not contain a contract tx to pay this blocks storage (created in the next block)
    // next farmer will create a contract for this block based on CoS for this block 

    const profile = this.wallet.getProfile()

    const blockData: Block['value'] = {
      height: 0,
      previousBlock: null,
      spacePledged: 0,
      immutableReserved: 0,
      mutableReserved: 0,
      immutableCost: 0,
      mutableCost: 0,
      creditSupply: 0,
      hostCount: 1,
      solution: null,
      pledge: spacePledged,
      publicKey: profile.publicKey,
      signature: null,
      txSet: new Set()
    }

    const block = new Block(blockData)

    // compute cost of mutable and immutable storage
    block.setMutableCost(this.computeMutableCost(100, blockData.pledge))
    block.setImmutableCost(this.computeImmutableCost(blockData.mutableCost, blockData.mutableReserved, blockData.immutableReserved))

    // create the reward tx and record, add to tx set
    const receiver = crypto.getHash(profile.publicKey)
    const rewardTx = this.createRewardTx(receiver, blockData.immutableCost, blockData.previousBlock)
    const rewardRecord = await Record.createImmutable(rewardTx.value, false, profile.publicKey, false)
    await rewardRecord.unpack(profile.privatKeyObject)
    block.addRewardTx(rewardRecord)

    // create the pledge tx and record, add to tx set
    const pledgeRecord = await this.createPledgeTx(profile.publicKey, this.wallet.profile.proof.id, spacePledged, pledgeInterval, blockData.immutableCost)
    block.addPledgeTx(pledgeRecord)
    this.validTxs.set(pledgeRecord.key, {...pledgeRecord.value})

    // create the block, sign and convert to a record
    await block.sign(profile.privateKeyObject)
    const blockRecord = await Record.createImmutable(block.value, false, profile.publicKey)
    await blockRecord.unpack(profile.privateKeyObject)

    // apply and emit the block 
    this.emit('block-solution', blockRecord)
    await this.applyBlock(blockRecord)
  }

  private computeSolution() {
    // called once a new block round starts
    // create a dummy block to compute solution and delay
    const block = new Block(null)
    const solution = block.getBestSolution(this.wallet.profile.proof.plot)
    const time = block.getTimeDelay()

    
    // set a timer to wait for time delay to checking if soltuion is best
    setTimeout( async () => {
      if (this.isBestBlockSolution(solution)) {
        const block = await this.createBlock()
        this.validBlocks.unshift(block.key)
        this.pendingBlocks.set(block.key, {...block.value})
        this.emit('block-solution', block)
        // if still best solution when block interval expires, it will be applied
      }
    }, time)
  }

  private async createBlock() {
     // called from compute solution after my time delay expires or on bootstrap
     // since we are using pending stats, there cannot be any async code between stats assignment and creating the tx set, else they could get out of sync if a new tx is added during assignment

    // contract tx will be added from last block
    // reward tx is created on apply block if this is most valid block 

    const profile = this.wallet.getProfile()
    const blockData: Block['value'] = {
      height: this.getHeight(),
      previousBlock: this.getLastBlockId(),
      spacePledged: this.pendingSpacePledged,
      immutableReserved: this.pendingImmutableReserved,
      mutableReserved: this.pendingMutableReserved,
      immutableCost: null,
      mutableCost: null,
      creditSupply: this.pendingCreditSupply,
      hostCount: this.pendingHostCount,
      solution: null,
      pledge: this.wallet.profile.proof.size,
      publicKey: profile.publicKey,
      signature: null,
      txSet: new Set()
    }

    const block = await Block.create(blockData)

    // create the reward tx for the next block and add to tx set, add to valid txs at applyBlock
    const rewardTx = this.createRewardTx(profile.publicKey, this.clearedImmutableCost, blockData.previousBlock)
    const rewardRecord = await Record.createImmutable(rewardTx.value, false, profile.publicKey, false)
    await rewardRecord.unpack(profile.privateKeyObject)
    block.addRewardTx(rewardRecord)
    
    // add all valid tx's in the mempool into the tx set 
    for (const [txId] of this.validTxs) {
      block.addTx(txId)
     }
     
    // compute cost of mutable and immutable storage for this block
    block.setMutableCost(this.computeMutableCost(blockData.creditSupply, blockData.spacePledged))
    block.setImmutableCost(this.computeImmutableCost(blockData.mutableCost, blockData.mutableReserved, blockData.immutableReserved))

    // get best solution, sign and convert to a record
    block.getBestSolution(this.wallet.profile.proof.plot)
    await block.sign(profile.privateKeyObject)
    const blockRecord = await Record.createImmutable(block.value, false, profile.publicKey)
    await blockRecord.unpack(profile.privateKeyObject)
    return blockRecord  

    // should not be able to add any tx's created after my proof of time expires
    // should add validation to ensure nobody else is doing this 
    // how do you prevent clients from backdating timestamps to try and get them into the block sooner?

  }

  async onTx(record: Record) {
    // called from core when a new tx is recieved via gossip
    // validates the tx and adds to mempool updating the pending UTXO balances

    if (this.validTxs.has(record.key) || this.invalidTxs.has(record.key)) {
      return {
        valid: false,
        reason: 'already have tx'
      }
    }

    // validate the tx
    const tx = new Tx(record.value.content)
    const senderBalance = this.getBalance(crypto.getHash(tx.value.sender))
    const txTest = await tx.isValid(record.getSize(), this.clearedMutableCost, this.clearedImmutableCost, senderBalance, this.clearedHostCount)

    // ensure extra reward tx are not being created
    if (tx.value.type === 'reward') {
      throw new Error('Invalid tx, reward txs are not gossiped')
    }

    // ensure extras storage contracts are not being created
    if (tx.value.type === 'contract' && tx.value.sender === NEXUS_ADDRESS) {
      throw new Error('Invalid tx, block storage contracts are not gossiped')
    }

    if (!txTest.valid) {
      this.invalidTxs.add(record.key)
      return txTest
    }

    await this.applyTx(tx, record)
    
    this.validTxs.set(record.key, {...record.value})

    txTest.valid = true
    return txTest
  }

  private async applyTx(tx: Tx, record: Record) {
    // called three times
      // onTx -> apply each new tx to pending UTXO
        // dont know who the farmer is 
      // addBlock -> apply each tx in block to last block UTXO (rewinded) to reset UTXO to block
        // here we do know who the farmer is
      // addBlock -> apply each remaining valid tx in mempool to new block UTXO to arrive back at pending UTXO
        // here we do not know who the farmer is 
  

    let nexusBalance: number, txStorageCost: number, txFee: number, farmerBalance: number 

    switch(tx.value.type) {
      case('credit'):
        // credit the recipient
        if (this.pendingBalances.has(tx.value.receiver)) {
          let receiverBalance = this.pendingBalances.get(tx.value.receiver)
          receiverBalance += tx.value.amount
          this.pendingBalances.set(tx.value.receiver, receiverBalance)
        } else {
          this.pendingBalances.set(tx.value.receiver, tx.value.amount)
        }

        // seperate tx fee from base storage cost
        txStorageCost = tx.getCost(this.clearedImmutableCost, 1)
        txFee = tx.value.cost - txStorageCost
          
        // debit the sender
        const senderAddress = crypto.getHash(tx.value.sender)
        let senderBalance = this.pendingBalances.get(senderAddress)
        senderBalance -= tx.value.amount + tx.value.cost
        this.pendingBalances.set(senderAddress, senderBalance)

        // pay tx cost to the nexus
        nexusBalance = this.pendingBalances.get(NEXUS_ADDRESS)
        nexusBalance += txStorageCost

        // pay tx fee to the farmer, but we don't know who the farmer is yet ... 
        farmerBalance = this.pendingBalances.get(FARMER_ADDRESS)
        farmerBalance += txFee 
        break
      case('pledge'):
        // add the pledge to pledges
        this.pendingPledges.set(
          record.key, {
            host: tx.value.sender,
            size: tx.value.spacePledged,
            interval: tx.value.pledgeInterval,
            proof: tx.value.pledgeProof,
            createdAt: record.value.createdAt
          })

          // adjust space pledged
          this.pendingSpacePledged += tx.value.spacePledged
          this.pendingSpaceAvailable += tx.value.spacePledged

          // adjust host count
          this.pendingHostCount += 1

          // seperate tx fee from base storage cost
          // removed for now, since nexus is getting full fee
          // txCost = tx.getCost(this.oldImmutableCost, 1)
          // txFee = tx.value.cost - txCost

          // deduct tx fees from the nexus
          nexusBalance = this.pendingBalances.get(NEXUS_ADDRESS)
          nexusBalance -= tx.value.cost

          // pay tx fees to back to the nexus
          nexusBalance += tx.value.cost

          // pay tx fee to the farmer, but we don't know who the farmer is yet ... 
          // removed for now, since nexus is getting full fee
          // farmerBalance = this.balances.get(FARMER_ADDRESS)
          // farmerBalance += txFee
          break
      case('contract'):
        // have to ensure the farmer does not apply a tx fee to the block storage payment 

        // add the contract to contracts
        this.pendingContracts.set(
          record.key, {
            id: record.key,
            contractSig: tx.value.contractSig,
            contractId: tx.value.contractId,
            spaceReserved: tx.value.spaceReserved,
            replicationFactor: tx.value.replicationFactor,
            ttl: tx.value.ttl,
            createdAt: record.value.createdAt
          }
        )

        // adjust space reserved and available
        if (tx.value.ttl) {
          this.pendingMutableReserved += tx.value.spaceReserved
        } else {
          this.pendingImmutableReserved += tx.value.spaceReserved
        }
        this.pendingSpaceAvailable -= tx.value.spaceReserved

        // seperate tx fee from base storage cost
        txStorageCost = tx.getCost(this.clearedImmutableCost, 1)
        txFee = tx.value.cost - txStorageCost

        // credit nexus and pay fees
        nexusBalance = this.pendingBalances.get(NEXUS_ADDRESS)
        nexusBalance += tx.value.amount + txStorageCost
        this.pendingBalances.set(NEXUS_ADDRESS, nexusBalance)

        // debit reserver
        let reserverAddress: string
        if (tx.value.sender) {
          reserverAddress = crypto.getHash(tx.value.sender)
        } else {
          reserverAddress = NEXUS_ADDRESS
        }
        
        let reserverBalance = this.pendingBalances.get(reserverAddress)
        reserverBalance -= tx.value.amount
        this.pendingBalances.set(reserverAddress, reserverBalance)

        // pay tx fee to the farmer, but we don't know who the farmer is yet ... 
        farmerBalance = this.pendingBalances.get(FARMER_ADDRESS)
        farmerBalance += txFee
        break
      case('nexus'):
        // nexus originaly paid tx cost for pledge
        // nexus is now paying tx cost for payment
        // host has to pay back both tx costs to the nexus (deducted from payment)

        // have to separate out the storage cost and tx fee here as well ... 
        // have to find the block this was included in to get the cost of storage 
          // search each block until you find the tx ...
          // could you keep an index of tx to blocks locally ?

        // simple solution for now is to pay the nexus the full fee for pledges 
        // we can resolve later once we have a better data structure for querying records 
        const stringValue = await this.storage.get(tx.value.pledgeTx)
        const value = JSON.parse(stringValue)
        const pledgedRecord = Record.readPacked(tx.value.pledgeTx, value)
        const pledgeCost = pledgedRecord.value.content.cost

        // seperate tx fee from base storage cost
        txStorageCost = tx.getCost(this.clearedImmutableCost, 1)
        txFee = tx.value.cost - txStorageCost

        // debit nexus 
        nexusBalance = this.pendingBalances.get(NEXUS_ADDRESS)
        nexusBalance -= (tx.value.amount - txStorageCost - pledgeCost)
        this.pendingBalances.set(NEXUS_ADDRESS, nexusBalance)

        // credit host 
        if (this.pendingBalances.has(tx.value.receiver)) {
          let hostBalance = this.pendingBalances.get(tx.value.receiver)
          hostBalance += (tx.value.amount - tx.value.cost - pledgeCost)
          this.pendingBalances.set(tx.value.receiver, hostBalance)
        } else {
          this.pendingBalances.set(tx.value.receiver, tx.value.amount)
        }

        // pay tx fee to the farmer, but we don't know who the farmer is yet ... 
        farmerBalance = this.pendingBalances.get(FARMER_ADDRESS)
        farmerBalance += txFee
        break
      case('reward'):
        // credit the winner and deduct tx fees

        // seperate tx fee from base storage cost
        // keep in for now, eventually remove tx fee from farmer reward payment
        txStorageCost = tx.getCost(this.clearedImmutableCost, 1)
        txFee = tx.value.cost - txStorageCost

        if (this.pendingBalances.has(tx.value.receiver)) {
          let receiverBalance = this.pendingBalances.get(tx.value.receiver)
          receiverBalance += tx.value.amount - tx.value.cost
          this.pendingBalances.set(tx.value.receiver, receiverBalance)
        } else {
          this.pendingBalances.set(tx.value.receiver, tx.value.amount - tx.value.cost)
        }
        
        // update the credit supply
        this.pendingCreditSupply += tx.value.amount

        // pay tx fees to the nexus
        nexusBalance = this.pendingBalances.get(NEXUS_ADDRESS)
        nexusBalance += txStorageCost

        // pay tx fee to the farmer, but we don't know who the farmer is yet ... 
        farmerBalance = this.pendingBalances.get(FARMER_ADDRESS)
        farmerBalance += txFee
        break
      default:
        throw new Error('Unkown tx type')
    }  
  }
  
  async onBlock(record: Record) {
    // called from core when a new block is received via gossip
    // validates the block and checks if best solution before adding to blocks
    // wait until the block interval expires before applying the block

    // is this a new block?
    if (this.validBlocks.includes(record.key) || this.invalidBlocks.includes(record.key) || this.chain.includes(record.key)) {
      return {
        valid: false,
        reason: 'already have block'
      }
    }

    const block = new Block(record.value.content)
  
    // fetch the last block header to compare
    const previousBlockKey = this.chain[this.chain.length - 1]
    const previousBlockRecordValue = this.clearedBlocks.get(previousBlockKey)
    const previousBlock = {
      key: previousBlockKey,
      value: {...previousBlockRecordValue.content}
    }

    // is the block valid?
    const blockTest = await block.isValid(record, previousBlock)
    if (!blockTest.valid) {
      this.invalidBlocks.push(record.key)
      return blockTest
    }

    // review the tx set for valid tx and validate block constants
    let spacePledged = previousBlock.value.spacePledged
    let immutableReserved = previousBlock.value.immutableReserved 
    let mutableReserved = previousBlock.value.mutableReserved
    let hostCount = previousBlock.value.hostCount
    let creditSupply = previousBlock.value.creditSupply

    // create the reward tx 
    const profile = this.wallet.getProfile()
    const rewardTx = this.createRewardTx(block.value.publicKey, previousBlock.value.immutableCost, previousBlock.value.previousBlock)
    const rewardRecord = await Record.createImmutable(rewardTx.value, false, profile.publicKey, false)
    rewardRecord.unpack(profile.privateKeyObject)

    // later, validate there is only one reward tx and one block storage tx per block

    for (const txId of block.value.txSet) {
      // check if in the memPool map
      if (! this.validTxs.has(txId)) {
        // if not in mempool check if it is invalid set
        if (this.invalidTxs.has(txId)) {
          this.invalidBlocks.push(record.key)
          return {
            valid: false,
            reason: 'Invalid block, block contains an invalid tx'
          }
        } else if(txId === rewardRecord.key) {
          // this is the reward tx 
          creditSupply += rewardRecord.value.content.amount
        } else {
          // throw error for now, later request the tx, then validate the tx
          throw new Error('Tx in proposed block is not in the mem pool')
        }
      }

      const recordValue = this.validTxs.get(txId)
      const tx = {...recordValue.content}
      if (tx.type === 'pledge') {  
        // if pledge, modify spaceAvailable, add to host count 
        spacePledged += tx.spacePledged
        hostCount += 1
      } else if (tx.type === 'contract') {  
        // if contract, modify space reserved
        if (tx.ttl) {
          mutableReserved += tx.spaceReserved
        } else {
          immutableReserved += tx.spaceReserved
        }
      }
    }

    // recalculate available space and costs
    const spaceAvailable = spacePledged - mutableReserved - immutableReserved
    const mutableCost = this.computeMutableCost(creditSupply, spaceAvailable)
    const immutableCost = this.computeImmutableCost(mutableCost, mutableReserved, immutableReserved)
    
    // are the block constants calculated correctly?
    if (!(spacePledged === block.value.spacePledged &&
        immutableReserved === block.value.immutableReserved &&
        mutableReserved === block.value.mutableReserved &&
        immutableCost === block.value.immutableCost &&
        mutableCost === block.value.mutableCost &&
        hostCount === block.value.hostCount &&
        creditSupply === block.value.creditSupply
    )) {
      this.invalidBlocks.push(record.key)
      return {
        valid: false,
        reason: 'Invalid block, block constants are not correct'
      }
    }

    // is it the best solution proposed?
    if (this.isBestBlockSolution(block.value.solution)) {
      this.validBlocks.unshift(record.key)
      this.pendingBlocks.set(record.key, {...record.value})
    } else {
      this.validBlocks.push(record.key)
    }

    blockTest.valid = true 
    return blockTest
  }

  public async applyBlock(block: Record) {
    // called from bootstrap after block is ready
    // called from self after interval expires
    // this is the best block for this round
    // apply the block to UTXO and reset everything for the next round

    // create a reward tx for this block and add to valid tx's 
    const profile = this.wallet.getProfile()

    // have to handle reward for genesis block (no immutable cost at that point)

    // create the reward tx for this block and add to mempool
    const receiver = crypto.getHash(block.value.content.publicKey)
    const rewardTx = this.createRewardTx(receiver, block.value.content.immutableCost, block.value.content.previousBlock)
    const rewardRecord = await Record.createImmutable(rewardTx.value, false, profile.publicKey, false)
    await rewardRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(rewardRecord.key, {...rewardRecord.value})

    // save the block and add to cleared blocks, flush the pending blocks 
    await rewardRecord.pack(profile.publicKey)
    await this.storage.put(block.key, JSON.stringify(block.value))
    this.clearedBlocks.set(block.key, {...block.value})
    
    // add the block to my chain 
    this.chain.push(block.key)

    // flush the block and tx mempool 
    this.validBlocks = []
    this.invalidBlocks = []
    this.pendingBlocks.clear()
    this.invalidTxs.clear()

    // save immutable cost for block tx cost calculations
    const oldImmutableCost = this.clearedImmutableReserved

    // reset all pending values back to cleared (rewind pending UTXO back to last block)
    this.pendingSpacePledged = this.clearedSpacePledged 
    this.pendingMutableReserved = this.clearedMutableReserved
    this.pendingImmutableReserved = this.clearedImmutableReserved
    this.pendingSpaceAvailable = this.clearedSpaceAvailable
    this.pendingHostCount = this.clearedHostCount
    this.pendingCreditSupply = this.clearedCreditSupply
    this.pendingMutableCost = this.clearedMutableCost
    this.pendingImmutableCost = this.clearedImmutableCost

    this.pendingBalances = new Map(this.clearedBalances)
    this.pendingContracts = new Map(this.clearedContracts)
    this.pendingPledges = new Map(this.clearedPledges)

    // what is the purpose here?
      // apply all tx in the block to our UTXO
      // getting all the records for the block storage contract
      // getting the size of the block storage contract by computing size of each tx 
      // compile the farmer rewards and add to their balance
        // block -> no : simply don't include
        // reward tx -> no : create this way
        // contract tx -> no : create this way
        // every other tx, yes 

    let blockStorageFees = 0
    let blockSpaceReserved = block.getSize()
    const recordIds = new Set([block.key])
    for (const txId of block.value.content.txSet) {
      // get the tx value and record
      const txRecordValue = this.validTxs.get(txId)
      const txRecord = new Record(txId, {...txRecordValue})
      const tx = new Tx({...txRecordValue.content})

      // get cost of storage to sum cost of storage contract and farmer fees
      recordIds.add(txId)
      
      const recordSize = txRecord.getSize()
      const recordStorageCost = recordSize * oldImmutableCost
      blockSpaceReserved += recordSize
      if (tx.value.type !== 'pledge') {
        // dont pay to farmer since full payment is going to nexus now
        blockStorageFees += (tx.value.cost - recordStorageCost)
      }

      // apply the tx to stats and pending balances, save, and delete from memPool
      await this.applyTx(tx, txRecord)
      await txRecord.pack(profile.privateKeyObject)
      this.storage.put(txId, JSON.stringify(txRecord.value))
      this.validTxs.delete(txId)
    }

    // add storage fees to farmer balance 
    const farmerBalance = this.pendingBalances.get(crypto.getHash(block.value.content.publicKey))
    this.pendingBalances.set(crypto.getHash(block.value.content.publicKey), farmerBalance + blockStorageFees)

    // recalculate mutable and immutable cost
    this.pendingMutableCost = this.computeMutableCost(this.pendingCreditSupply, this.pendingSpaceAvailable)
    this.pendingImmutableCost = this.computeImmutableCost(this.pendingMutableCost, this.pendingImmutableReserved, this.pendingMutableReserved)

    // sum fees from tx set and the storage contract to be added to the next block, add to valid txs
    const contractTx = await this.createImmutableContractTx(null, oldImmutableCost, this.pendingBalances.get(NEXUS_ADDRESS), blockSpaceReserved, recordIds, profile.privateKeyObject)
    const contractRecord = await Record.createImmutable(contractTx.value, false, profile.publicKey, false)
    await contractRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(contractRecord.key, {...contractRecord.value})

    // reset cleared balances back to pending (fast-forward cleared utxo to this block)
    this.clearedSpacePledged = this.pendingSpacePledged
    this.clearedMutableReserved = this.pendingMutableReserved
    this.clearedImmutableReserved = this.pendingImmutableReserved
    this.clearedSpaceAvailable = this.pendingSpaceAvailable
    this.clearedHostCount = this.pendingHostCount
    this.clearedCreditSupply = this.pendingCreditSupply
    this.clearedMutableCost = this.pendingMutableCost
    this.clearedImmutableCost = this.pendingImmutableCost

    this.clearedBalances = new Map(this.pendingBalances)
    this.clearedContracts = new Map(this.pendingContracts)
    this.clearedPledges = new Map(this.pendingPledges)

    this.pendingContracts.clear()
    this.pendingPledges.clear()
    
    // apply each remaining valid tx in the memPool to pending (get pending back up to date on mepool)
    // have to ensure the tx fee is still valid with new cost of storage
    for (const [key, value] of this.validTxs) {
      const pendingTxRecord = new Record(key, value)
      const pendingTx = new Tx(value.content)
      let senderAddress: string
      if (pendingTx.value.sender) {
        senderAddress = crypto.getHash(pendingTx.value.sender)
      } else {
        senderAddress = NEXUS_ADDRESS
      }
      const testTx = await pendingTx.isValid(pendingTxRecord.getSize(), this.clearedImmutableCost, this.clearedMutableCost, this.pendingBalances.get(senderAddress), this.clearedHostCount )
      if (testTx.valid) {
        await this.applyTx(pendingTx, pendingTxRecord)
      } else {
        // drop the tx, client will have to create a new tx that covers tx fees
        this.validTxs.delete(key)
        this.invalidTxs.add(key)
        throw new Error('Invalid tx')
      }
    }

    if (this.isFarming) {
      this.computeSolution()
    }

    // set a new interval to wait before applying the next most valid block
    setTimeout( async () => {
      const blockId = this.validBlocks[0]
      const blockValue = this.pendingBlocks.get(blockId)
      const blockRecord = Record.readUnpacked(blockId, {...blockValue})
      await this.applyBlock(blockRecord)
    }, BLOCK_IN_MS)    
  }

  public createRewardTx(receiver: string, immutableCost: number, previousBlock: string) {
    // creates a reward tx for any farmer instance and calculates the fee
   return Tx.createRewardTx(receiver, previousBlock, immutableCost)
  }

  public async createCreditTx(sender: string, receiver: string, amount: number) {
    // creates a credit tx instance and calculates the fee
    const profile = this.wallet.getProfile()

    const tx = await Tx.createCreditTx(sender, receiver, amount, this.clearedImmutableCost, profile.privateKeyObject)

    // check to make sure you have the funds available
    if (tx.value.cost > this.getBalance(sender)) {
      throw new Error('insufficient funds for tx')
    }

    // create the record, add to the mempool, apply to balances
    const txRecord = await Record.createImmutable(tx.value, false, profile.publicKey)
    await txRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(txRecord.key, {...txRecord.value})
    await this.applyTx(tx, txRecord)
    return txRecord
  }

  public async createPledgeTx(sender: string, proof: string, spacePledged: number, interval = MIN_PLEDGE_INTERVAL, immutableCost = this.clearedImmutableCost) {
    // creates a pledge tx instance and calculates the fee
    const profile = this.wallet.getProfile()
    const tx = await Tx.createPledgeTx(proof, spacePledged, interval, immutableCost, profile.privateKeyObject)
    const txRecord = await Record.createImmutable(tx.value, false, profile.publicKey)
    await txRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(txRecord.key, {...txRecord.value})
    await this.applyTx(tx, txRecord)
    return txRecord
  }

  public async createNexusTx(sender: string, pledgeTx: string, amount: number, immutableCost: number) {
    // creates a nexus to host payment tx instance and calculates the fee
    const profile = this.wallet.getProfile()
    const tx = Tx.createNexusTx(sender, amount, pledgeTx, immutableCost)
    const txRecord = await Record.createImmutable(tx.value, false, profile.publicKey)
    await txRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(txRecord.key, {...txRecord.value})
    await this.applyTx(tx, txRecord)
    return txRecord
  }

  public async createImmutableContractTx(sender: string, immutableCost: number, senderBalance: number, spaceReserved: number, records: Set <string>, privateKeyObject: any, multiplier: number = TX_FEE_MULTIPLIER) {
    // reserve a fixed amount of immutable storage on SSDB with known records

    const cost = spaceReserved * immutableCost
    const tx = await Tx.createImmutableContractTx(sender, cost, spaceReserved, records, immutableCost, multiplier, privateKeyObject)
  
    // check to make sure you have the funds available 
    if (tx.value.cost > senderBalance) {
      throw new Error('Insufficient funds for tx')
    }

    return tx
  }

  public async createMutableContractTx(spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string) {
    // reserve space on SSDB with a mutable storage contract
    // have to create or pass in the keys

    const profile = this.wallet.getProfile()
    
    const cost = this.clearedMutableCost * spaceReserved * replicationFactor * ttl

    const tx = await Tx.createMutableContractTx(profile.publicKey, spaceReserved, replicationFactor, ttl, cost, contractSig, contractId, this.clearedImmutableCost, profile.privateKeyObject)

    // check to make sure you have the funds available 
    if (tx.value.cost > this.pendingBalances.get(crypto.getHash(profile.publicKey))) {
      throw new Error('insufficient funds for tx')
    }

    // return the record 

    const txRecord = await Record.createImmutable(tx.value, false, profile.publicKey)
    await txRecord.unpack(profile.privateKeyObject)
    this.validTxs.set(txRecord.key, {...txRecord.value})
    await this.applyTx(tx, txRecord)
    return txRecord
  } 
}
 
export class Block {
   _value: {
    height: number            
    previousBlock: string 
    spacePledged: number 
    immutableReserved: number
    mutableReserved: number
    immutableCost: number
    mutableCost: number
    creditSupply: number
    hostCount: number
    txSet: Set<string>    // set of tx in the block
    solution: string      // farmer closest solution by XOR
    pledge: number        // size of pledge of proposing farmer
    publicKey: string     // full public key of farmer
    signature: string     // farmer signature
  }

  constructor(_value: Block['value']) {
    this._value = _value
  }


  // getters

  get value() {
    return this._value
  }

  // static methods

  static async create(blockData: Block['value']) {
    const block = new Block(blockData)
    return block
  }

  // public methods

  public addTx(tx: string) {
    this._value.txSet.add(tx)
  }

  public setImmutableCost(cost: number) {
    this._value.immutableCost = cost
  }

  public setMutableCost(cost: number) {
    this._value.mutableCost = cost
  }

  public addRewardTx(rewardRecord: Record) {
    this._value.creditSupply += rewardRecord.value.content.amount
    this._value.txSet.add(rewardRecord.key)
  }

  public addPledgeTx(pledgeRecord: Record) {
    this._value.spacePledged += pledgeRecord.value.content.spacePledged
    this._value.txSet.add(pledgeRecord.key)
  }

  public async isValidGenesisBlock(block: Record) {
    let response = {
      valid: false,
      reason: <string> null
    }

    // does it have height 0 
    if (this._value.height !== 0) {
      response.reason = 'invalid genesis block, wrong block height'
      return response
    }

    // is the record size under 1 MB
    if (block.getSize() > 1000000) {
      response.reason = 'invalid genesis block, block is larger than one megabyte'
      return response
    }

    // does it have null solution 
    if (this._value.solution) {
      response.reason = 'invalid genesis block, should not have a solution'
      return response
    }

    // has space been pledged
    if (!this._value.spacePledged) {
      response.reason = 'invalid genesis block, no space has been pledged'
      return response
    }

    // has space been reserved
    if (this._value.immutableReserved || this._value.mutableReserved) {
      response.reason = 'invalid genesis block, should not have any space reserved'
      return response
    }

    // is credit supply right
    if (this._value.creditSupply !== 100) {
      response.reason = 'invalid genesis block, wrong initial credit supply'
      return response
    }

    // is host count right
    if (this._value.hostCount !== 1) {
      response.reason = 'invalid genesis block, wrong initial host count'
      return response
    }

    // are there two txs
    if (this._value.txSet.size !== 2) {
      response.reason = 'invalid genesis block, can only have two tx'
      return response
    }

    // does pledge equals spacePledged
    if (this._value.spacePledged !== this._value.pledge) {
      response.reason = 'invalid genesis block, pledge is not equal to space pledged'
      return response
    }

    // correct mutable cost
    const mutableCost = Ledger.getMutableCost(this._value.creditSupply, this._value.spacePledged)
    if (this._value.mutableCost !== mutableCost) {
      response.reason = 'invalid genesis block, invalid mutable cost of storage'
      return response
    }
    
    // correct immutable cost
    const immutableCost = Ledger.getImmutableCost(this._value.mutableCost, this._value.mutableReserved, this._value.immutableReserved)
    if (this._value.immutableCost !== immutableCost) {
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

  public async isValid(newBlock: Record, previousBlock: {key: string, value: Block['value']}) {
    // check if the block is valid

    let response = {
      valid: false,
      reason: <string> null
    }
    
    // is it at the correct height?
    if (this._value.height !== previousBlock.value.height) {
      response.reason = 'invalid block, wrong block height'
      return response
    }

    // does it reference the correct last block?
    if (this._value.previousBlock !== previousBlock.key) {
      response.reason = 'invalid block, references incorrect parent block'
      return response
    }

    // is the record size under 1 MB
    if (newBlock.getSize() > 1000000) {
      response.reason = 'invalid block, block is larger than one megabyte'
      return response
    }

    // is the solution valid?
    if (! this.isValidSolution(newBlock.value.publicKey)) {
      response.reason = 'invalid block, solution is invalid'
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

  public getBestSolution(plot: Set<string>) {
    // searches a plot for the best solution to the block challenge
    const bufferPlot = [...plot].map(solution => Buffer.from(solution))
    const bufferChallnege = Buffer.from(this.value.previousBlock)
    const bufferSoltuion = getClosestIdByXor(bufferChallnege, bufferPlot)
    this._value.solution = bufferSoltuion.toString()
    return this._value.solution
  }

  public isValidSolution(publicKey: string) {
    // check if the included block solution is the best for the last block
    const seed = crypto.getHash(publicKey)
    const proof = crypto.createProofOfSpace(seed, this._value.pledge)
    return this._value.solution === this.getBestSolution(proof.plot)
  }

  public getTimeDelay(seed: string = this._value.solution ) {
    // computes the time delay for my solution, later a real VDF
   return crypto.createProofOfTime(seed)
  }

  public async sign(privateKeyObject: any) {
    // signs the block
    this._value.signature = await crypto.sign(JSON.stringify(this._value), privateKeyObject)
  }

  public async isValidSignature() {
    const unsignedBlock = { ...this._value} 
    unsignedBlock.signature = null
    return await crypto.isValidSignature(unsignedBlock, this._value.signature, this._value.publicKey)
  }

  // private methods

 


}

export class Tx {
  _value: {
    type: string
    sender: string
    receiver: string
    amount: number
    cost: number
    signature: string
    previousBlock?: string
    pledgeProof?: string
    spacePledged?: number
    pledgeInterval?: number
    pledgeTx?: string
    spaceReserved?: number
    ttl?: number
    replicationFactor?: number
    recordIndex?: Set<string>
    contractSig?: string
    contractId?: string
  }
  
  constructor(value: Tx['value']) {
    this._value = value
  }

  // getters

  get value() {
    return this._value
  }

  // static methods

  static createRewardTx(receiver: string, previousBlock: string, immutableCost: number) {
    // create and return new reward tx for farmer who solved the block challenge

    const value: Tx['value'] = {
      type: 'reward',
      sender: null,
      receiver: receiver,
      previousBlock,
      amount: 100,
      cost: null,
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost, 1)
    return tx
  }

  static async createCreditTx(sender: string, receiver: string, amount: number, immutableCost: number, privateKeyObject: any) {
    // create and return a new credit tx, sends credits between two addresses

    const value: Tx['value'] = {
      type: 'credit',
      sender,
      receiver,
      amount,
      cost: null,
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost)
    await tx.sign(privateKeyObject)
    return tx
  }

  static async createPledgeTx(proof: string, spacePledged: number, interval: number, immutableCost: number, privateKeyObject: any) {
    // create a new host pledge tx

    const value: Tx['value'] = {
      type: 'pledge',
      sender: NEXUS_ADDRESS,
      receiver: NEXUS_ADDRESS,
      amount: 0,
      cost: null,
      pledgeProof: proof,
      spacePledged: spacePledged,
      pledgeInterval: interval,
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost)
    await tx.sign(privateKeyObject)
    return tx
  }

  static createNexusTx(sender: string, amount: number, pledgeTx: string, immutableCost: number) {
    // create a host payment request tx

    // needs to be signed by the host so it may not be submitted on their behalf

    const value: Tx['value'] = {
      type: 'nexus',
      sender,
      receiver: NEXUS_ADDRESS,
      amount,
      cost: null,
      pledgeTx,
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost)
    return tx
  }

  static async createImmutableContractTx(sender: string, cost: number, spaceReserved: number, records: Set<string>, immutableCost: number, multiplier: number, privateKeyObject: any) {
    // create a new contract tx to store immutable data

    const value: Tx['value'] = {
      type: 'contract',
      sender,
      receiver: NEXUS_ADDRESS,
      amount: cost,
      cost: 0,
      ttl: 0,
      spaceReserved,
      replicationFactor: 0,
      recordIndex: records,
      contractSig: '',
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost, multiplier)
    await tx.sign(privateKeyObject)
    return tx
  }

  static async createMutableContractTx(sender: string, cost: number, spaceReserved: number, replicationFactor: number, ttl: number, contractSig: string, contractId: string, immutableCost: number, privateKeyObject: any) {

    const value: Tx['value'] = {
      type: 'contract',
      sender,
      receiver: NEXUS_ADDRESS,
      amount: cost,
      cost: null,
      spaceReserved,
      ttl,
      replicationFactor,
      contractSig,
      contractId,
      signature: null
    }

    const tx = new Tx(value)
    tx.setCost(immutableCost)
    await tx.sign(privateKeyObject)
    return tx
  }

  // public methods

  public async isValid(size: number, immutableCost: number, mutableCost?: number, senderBalance?: number, hostCount?: number) {
    let response = {
      valid: false,
      reason: <string> null
    }

    // tx fee is correct
    if (!(this._value.cost >= size * immutableCost)) {
      response.reason = 'invalid tx, tx fee is too small'
      return response
    }

    // address has funds
    if (this._value.type !== 'reward' || this._value.sender !== NEXUS_ADDRESS) {
      if ((this._value.amount + this._value.cost) >= senderBalance) {
        response.reason = 'invalid tx, insufficient funds in address'
        return response
      }
    }

    // has valid signature
    if (['contract', 'pledge', 'credit'].includes(this._value.type)) {
      if (this._value.receiver !== NEXUS_ADDRESS) {
        if (! await this.isValidSignature()) {
          response.reason = 'invalid tx, invalid signature'
          return response
        }
      }
    }
    
    // special validation 
    switch(this._value.type) {
      case('pledge'): 
        response = this.isValidPledgeTx(response)
        break
      case('contract'):
        response = await this.isValidContractTx(response, hostCount, mutableCost, immutableCost)
        break
      case('nexus'): 
        response = this.isValidNexusTx(response)
        break
      case('reward'): 
        response = this.isValidRewardTx(response)
        break
      default: 
        throw new Error('invalid tx type, cannot validate')
    }
    response.valid = true
    return response
  }

  public isValidPledgeTx(response: any) {
    // validate pledge (proof of space)
    if (! crypto.isValidProofOfSpace(this._value.sender, this.value.spacePledged, this._value.pledgeProof)) {
      response.reason = 'invalid pledge tx, incorrect proof of space'
      return response
    }

    // size within range 10 GB to 1 TB
    if (!(this._value.spacePledged >= MIN_PLEDGE_SIZE || this._value.spacePledged <= MAX_PLEDGE_SIZE)) {
      response.reason = 'invalid pledge tx, pledge size out of range'
      return response
    }

    // payment interval within range one month to one year (ms)
    if (!(this._value.pledgeInterval >= MONTH_IN_MS || this._value.pledgeInterval <= YEAR_IN_MS)) {
      response.reason = 'invalid pledge tx, pledge interval out of range'
      return response
    }

    // should not have an active or pending pledge (later)

    response.valid = true
    return response
  }

  public async isValidContractTx(response: any, hostCount: number, mutableCost: number, immutableCost: number) {
    if (this._value.ttl) {  // mutable storage contract
    
      // validate TTL within range
      if (!(this._value.ttl >= HOUR_IN_MS || this._value.ttl <= YEAR_IN_MS)) {
        response.reason = 'invalid contract tx, ttl out of range'
        return response
      }

      // validate replicas within range
      if (!(this._value.replicationFactor >= 2 || this._value.replicationFactor <= Math.log2(hostCount))) {
        response.reason = 'invalid contract tx, replicas out of range'
        return response
      }

      // validate size within range
      if (!(this._value.spaceReserved >= MIN_MUTABLE_CONTRACT_SIZE || this._value.spaceReserved <= MAX_MUTABLE_CONTRACT_SIZE)) {
        response.reason = 'invalid contract tx, mutable space reserved out of range'
        return response
      }

      // validate the cost 
      if (this._value.amount !== (mutableCost * this._value.spaceReserved * this._value.replicationFactor * this.value.ttl)) {
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
      if (!(this._value.spaceReserved >= MIN_IMMUTABLE_CONTRACT_SIZE || this._value.spaceReserved <= MAX_IMMUTABLE_CONTRACT_SIZE)) {
        response.reason = 'invalid contract tx, immutable space reserved out of range'
        return response
      }

      // validate the cost
      if (this._value.amount !== (immutableCost * this._value.spaceReserved * this._value.replicationFactor)) {
        response.reason = 'invalid contract tx, incorrect cost of immutable space reserved'
        return response
      }

      // should only be able to make one immutable contract per block, later 
    }

    return response
  }

  public isValidNexusTx(response: any) {
    // does sender = nexus
    if (this._value.sender !== NEXUS_ADDRESS) {
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

  public isValidRewardTx(response: any) {
    // has null sender
    if(this._value.sender !== null) {
      response.reason = 'invalid reward tx, sender is not null'
      return response
    }

    // is less than or equal to 100 credits
    if(this._value.amount !== INITIAL_BLOCK_REWARD) {
      response.reason = 'invalid reward tx, invalid reward amount'
      return response
    }

    // is the block creator, how to know?
    // have to validate at block validation 
    // must ensure there are not additional reward tx placed insed the block tx set 

    response.valid = true
    return response
  }

  public getCost(immutableCost: number, incentiveMultiplier: number) {
    // we have to carefully extrapolate the size since fee is based on size
    // we know the base record size and that each integer for amount and fee is one byte
    // also have to add in a small buffer that 
      // provides an incentive to farmers to include the tx (they keep the difference)
      // handle variability in the cost of storage, if tx does not immediatlely get into the next block, since the cost of storage may be greater in the following block/s, which it will be validated against

    // get the tx fee, not inlcuding the tx fee value
    let baseSize
    switch(this.value.type) {
      case('credit'):
        baseSize = BASE_CREDIT_TX_RECORD_SIZE + this._value.amount.toString().length 
        break
      case('pledge'):
        baseSize = BASE_PLEDGE_TX_RECORD_SIZE + this._value.spacePledged.toString().length + this._value.pledgeInterval.toString().length + this._value.pledgeProof.length
        break
      case('contract'):
        baseSize = BASE_CONTRACT_TX_RECORD_SIZE + this._value.spaceReserved.toString().length + this._value.ttl.toString().length + this._value.replicationFactor.toString().length + this._value.contractSig.length
        break
      case('nexus'):
        // 64 bytes is size of string encoded SHA256
        baseSize = BASE_NEXUS_TX_RECORD_SIZE + this._value.amount.toString().length + 64
        break
      case('reward'):
        baseSize = BASE_REWARD_TX_RECORD_SIZE + this._value.amount.toString().length 
        break
    }
    
    const baseFee = (baseSize * immutableCost) * incentiveMultiplier

    // get the size of the tx fee value and add cost
    const feeSize = baseFee.toString().length
    const partialFee = feeSize * immutableCost
    const fullFee = baseFee + partialFee 

    // see if this has increased the length of the fee integer
    let finalfee: number
    if (fullFee.toString.length > partialFee.toString.length) {
      // if yes, recalculate the fee integer one more time to get final fee
      finalfee = (fullFee.toString().length * immutableCost) + baseFee
    } else {
      // if no, then we have the final fee
      finalfee = fullFee
    }
    return finalfee
  }

  public async isValidSignature() {
    const unsignedTx = { ...this._value} 
    unsignedTx.signature = null
    return await crypto.isValidSignature(unsignedTx, this._value.signature, this._value.sender)
  } 

  // private methods

  private setCost(immutableCost: number, multiplier = TX_FEE_MULTIPLIER) {
    this._value.cost = this.getCost(immutableCost, multiplier)
  }

  private async sign(privateKeyObject: any) {
    this._value.signature = await crypto.sign(JSON.stringify(this._value), privateKeyObject)
  }
    
}

// Block 0
  // reward tx
    // no inputs
    // 1 output of 100 credits to farmer
  // pledge tx: Tx_cost
    // no inputs
    // 1 output of tx_cost to nexus (how do you calculate tx cost?)
  // block header
// Block 1
  // reward tx: 100 credits
    // no inputs
    // 100 credits output to farmer 
  // contract tx: Cost(block 0): nexus -> nexus 
    // 1 input of block cost from nexus (for each)
      // based on cost of storage in the last block
      // must reference each tx output (to the nexus) specificially that was paid by the node who created each tx in the previous block 
      // will this make the contract as big the txSet of the last block?
      // does the full contract need to be sent with the block or just the hash?
      // is the contract in any way specific to the farmer who creates the block?
      // or could the contract be created by the previous farmer and sent out immediately after the next block is published?
      // if there is seperate contract state then it would need to be signed by somebody for authenticity , either the farmer who created the block the contract refers to, or the farmer who creates the block that the tx will be embedded in
      // What would other nodes need to verify?
      // If it were constructed in such a way that any node could create the contract tx locally, then simply verify that the hash is included in the next block, that might work ...
    // 1 single output of block cost to nexus
    // takes all inputs into the nexus from last block and converts into a single output
  // block header
// Block 2
  // reward tx
    // inputs 
      // 1 input for each tx as the tx fee, difference between tx amount and cost of storage
    // outputs
      // 100 credits to farmer (reward) plus sum of all tx fees
  // contract tx (block 1)
    // 1 input for each tx in previous block (specific input to nexus for tx cost)
    // 1 single output back to nexus
  // nexus payment tx ()
    // inputs
      // 1 input from nexus to cover tx cost
    // outputs 
      // 1 output back to nexus for original pledge cost and this tx cost
      // 1 output to host for remainder
      // 1 output to farmer for tx fee
  // credit tx
    // inputs
      // 1 input from sender
    // outputs
      // 1 output to nexus for storage cost
      // 1 output to farmer for tx fee
      // 1 output to recipient for amount
  // block header