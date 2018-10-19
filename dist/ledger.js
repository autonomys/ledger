"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("@subspace/crypto"));
const events_1 = require("events");
const utils_1 = require("@subspace/utils");
const YEAR_IN_MS = 31536000000; // 1 year in ms
const MONTH_IN_MS = 2628000000; // 1 momth in ms
const HOUR_IN_MS = 3600000; // 1 hour in ms 
const BLOCK_IN_MS = 600000; // 10 minutes in ms
const MIN_PLEDGE_INTERVAL = MONTH_IN_MS; // minium/standard pledge interval for a host
const CREDITS_PER_BYTE = .000000001; // cost one byte of storage on the ledger, for tx fees
const IMMUTABLE_STORAGE_MULTIPLIER = 10; // the relative cost of immutable storage to mutable storage
const BLOCKS_PER_MONTH = 43200; // 1 min * 60 * 24 * 30 = 43,200 blocks
const BYTES_PER_HASH = 1000000; // one hash per MB of pledge for simple proof of space, 32 eventually
const INITIAL_BLOCK_REWARD = 100; // intial block reward ins subspace credits
const MIN_IMMUTABLE_CONTRACT_SIZE = 1000000; // 1 MB
const MIN_MUTABLE_CONTRACT_SIZE = 1000000000; // 1 GB
const MAX_IMMUTABLE_CONTRACT_SIZE = .001 * this.spaceAvailable;
const MAX_MUTABLE_CONTRACT_SIZE = .1 * this.spaceAvailable;
const MIN_PLEDGE_SIZE = 10000000000; // 10 GB in bytes
const MAX_PLEDGE_SIZE = 1000000000; // 10 GB for now
class Ledger extends events_1.EventEmitter {
    constructor(storage, profile, tracker) {
        super();
        this.storage = storage;
        this.profile = profile;
        this.tracker = tracker;
        // ToDo
        // all arrays should be sets
        // Determine when to farm the next block 
        // Bootstrap the chain
        // Join an existing chain
        // decide what to do with utxo/stats functions
        // cacluclate costs correclty
        // cost of mutable storage
        // cost of immutable storage
        // nexus payment
        // expire the pledges (later)
        // remove from pledges
        // adjust space pledged
        // have host submit their own pledge payment request
        // expire the contracts (later)
        // remove contracts
        // adjust space reserved
        // adjust space available 
        // convert all of these to sets
        this.plot = [];
        this.chain = [];
        this.validBlocks = [];
        this.invalidBlocks = [];
        this.validTxs = [];
        this.invalidTxs = [];
        this.balances = new Map();
        this.pledges = new Map();
        this.contracts = new Map();
        this.spacePledged = 0;
        this.mutableStorageReserved = 0;
        this.immutableStorageReserved = 0;
        this.spaceAvailable = 0;
        this.creditSupply = 0;
        this.costOfMutableStorage = Infinity;
        this.costOfImmutableStorage = Infinity;
        this.hostCount = 0;
    }
    init() {
        // on startup
        // check for a saved plot 
        // check for a saved chain
        // get all blocks from network outstanding (work backwards)
        // get all pending tx from network 
        // compute the balances (UTXO)
        // calculate the cost of storage
    }
    async bootstrap() {
        try {
            // create the genesis block 
            // Single farmer chain to start
            // create a pledge (proof of space)
            // construct the genesis block (with coinbase tx)
            // publish the block (gossip)
            // farm the next block solution (compute best solution)
            // ...
            const block = await this.createBlock();
            this.emit('proposed-block', block);
            this.onBlock(block);
            this.startFarming();
        }
        catch (error) {
            console.log('Error creating proof of space pledge');
            console.log(error);
            this.emit(error);
            return error;
        }
    }
    async startFarming() {
        try {
            // get the blockchain from other or gateway 
            // on final block
            // start a timer of max time (11 minutes)
            // find my best solution
            // convert solution to sum of hex as numbers
            // wait that long in seconds
            // if best solution yet then publish my block
            // listen for other valid blocks
            // if better than my solution, hold
            // discard my block
            // wait until timer expires
            // or a better solution is proposed
        }
        catch (error) {
        }
    }
    async stopFarming() {
    }
    computeStats() {
        // returns
        // total number of valid hosts 
        // total number of credits
        // total amount of space pledged (active)
        // total amount of mutable storage reserved (active)
        // total amount of immutable storage reserve
        // cost of mutable storage
        // cost of immutable storage 
        // balance for each address
        // for each block
        // add coinbase to block winner
        // for each tx
        // debit balance of sender
        // credit balance of receiver
        // compute UTXO
        // if address in UTXO, mutate balance
        // else add address and set balance
        // calculate the cost of storage
    }
    getBalance(address) {
        return this.balances.get(address);
    }
    getBlockHeight() {
        return this.chain.length - 1;
    }
    calculateTxFee(tx) {
        return CREDITS_PER_BYTE * Buffer.byteLength(JSON.stringify(tx.value));
    }
    calculateCostofMutableStorage() {
        this.costOfMutableStorage = (this.creditSupply / this.spaceAvailable);
    }
    calculateCostOfImmutableStorage() {
        this.costOfImmutableStorage = this.costOfMutableStorage * IMMUTABLE_STORAGE_MULTIPLIER;
    }
    calculateNexusPayments() {
        // Needs work!
        // Nexus Payment
        // average space utilized over all blocks in interval
        // average CoS over all blocks in interval
        // uptime over the interval (from tracker)
        // amount of space provided by host as a proportion of all space
        // average utilization * uptime(from tracker) * average cost of storage
        // for each block 
        // calculate the proportion of space used
        // calculate the cost of storage
        const payments = [];
        // each block check the pledges to see which are due
        const blockHeight = this.getBlockHeight();
        const pledges = [];
        this.pledges.forEach(pledge => {
            if (pledge.blockDue === blockHeight) {
                pledges.push(pledge);
                // this assumes a constant block interval of 1 minutes
                // block intervals will not be constant however ... 
                // instead it would make more sense to check the timestamp
                pledge.blockDue = Math.floor(pledge.interval / 60000);
            }
        });
        if (pledges.length === 0) {
            return payments;
        }
        // assume all intervals are the same for hosts (1 month)
        // 1 min * 60 * 24 * 30 = 43,200 blocks
        // for each block 
        // average space reserved
        // average CoS
        let sumImmutableSpaceReserved = 0;
        let sumMutableSpaceReserved = 0;
        let sumCostofImmutableStorage = 0;
        let sumCostofMutableStorage = 0;
        let sumSpacePledged = 0;
        for (let i = blockHeight; i = blockHeight - BLOCKS_PER_MONTH; i--) {
            const block = this.storage.get(this.chain[i]);
            sumImmutableSpaceReserved += block.immutableSpaceReserved;
            sumMutableSpaceReserved += block.mutableSpaceReserved;
            sumCostofImmutableStorage += block.costOfImmutableStorage;
            sumCostofMutableStorage += block.costOfMutableStorage;
            sumSpacePledged += block.spacePledged;
        }
        const avgMutableValue = (sumCostofMutableStorage / BLOCKS_PER_MONTH) / (sumMutableSpaceReserved / BLOCKS_PER_MONTH);
        const avgImmutableValue = (sumCostofImmutableStorage / BLOCKS_PER_MONTH) / (sumImmutableSpaceReserved / BLOCKS_PER_MONTH);
        const mutableRatio = sumMutableSpaceReserved / sumSpacePledged;
        const immutableRatio = sumImmutableSpaceReserved / sumSpacePledged;
        const totalValue = avgMutableValue * mutableRatio + avgImmutableValue * immutableRatio;
        for (const pledge of pledges) {
            const hostData = this.tracker.get(pledge.host);
            const spaceFraction = pledge.size / sumSpacePledged;
            const timeFraction = hostData.uptime / MONTH_IN_MS;
            const myValue = totalValue * spaceFraction * timeFraction;
            const payment = {
                receiver: pledge.host,
                amount: myValue,
                contract: pledge.pledge
            };
            payments.push(payment);
        }
        return payments;
    }
    createProofOfTime(solution) {
        // calculates the time required for a given solution to process
        // converts each hex char to a number value between 1 and 16
        // sums the value for each char in the solution
        // this determines the time to wait before publishing block in seconds
        let time = 0;
        for (let char of solution) {
            time += parseInt(char, 16) + 1;
        }
        // return in ms
        return time * 1000;
    }
    isValidProofOfTime(solution, time) {
        return (time === this.createProofOfTime(solution));
    }
    async createProofOfSpace(key = null, size = MIN_PLEDGE_SIZE) {
        // create a mock proof of space to represent your disk plot
        const proofArray = [];
        const hashCount = size / BYTES_PER_HASH;
        if (!key)
            key = this.profile.activeKeyPair.publicKeyArmored;
        for (let i = 0; i < hashCount; i++) {
            key = crypto_1.default.getHash(key);
            proofArray.push(key);
        }
        const proof = {
            id: crypto_1.default.getHash(JSON.stringify(proofArray)),
            size: size,
            seed: key,
            plot: proofArray,
            createdAt: Date.now()
        };
        return proof;
    }
    async isValidProofofSpace(key, space, proofHash) {
        const proof = await this.createProofOfSpace(key, space);
        return proof.id === proofHash;
    }
    getBestSolution(challenge, plot = this.plot) {
        // checks your plot to find the closest solution by XOR
        const bufferedPlot = plot.map(solution => Buffer.from(solution));
        const bufferChallnege = Buffer.from(challenge);
        const bufferSoltuion = utils_1.getClosestIdByXor(bufferChallnege, bufferedPlot);
        return bufferSoltuion.toString();
    }
    async isValidSolution(solution, pledge, challenge, key) {
        // check if this solution is valid
        const proof = await this.createProofOfSpace(key, pledge);
        const mySolution = this.getBestSolution(challenge, proof.plot);
        return solution === mySolution;
    }
    isBestSolution(challenge, solution) {
        // check to see if the solution provided is the best solution yet provided for this block
        const bestSolution = this.validBlocks[0];
        if (bestSolution) {
            const source = Buffer.from(challenge);
            const contender = Buffer.from(bestSolution);
            const challenger = Buffer.from(solution);
            const targets = [contender, challenger];
            const closest = utils_1.getClosestIdByXor(source, targets);
            if (contender === closest)
                return false;
        }
        return true;
    }
    async createBlock() {
        // called on bootstrap or when if your solution is best after timer and proof of time elapse
        this.calculateCostofMutableStorage();
        this.calculateCostOfImmutableStorage();
        let solution = null;
        let lastBlockHash = null;
        let time = null;
        if (this.chain.length > 0) {
            lastBlockHash = this.chain[this.chain.length - 1];
            solution = this.getBestSolution(lastBlockHash);
            time = this.createProofOfTime(solution);
        }
        let block = {
            key: null,
            value: {
                height: this.getBlockHeight() + 1,
                lastBlock: lastBlockHash,
                solution: solution,
                time: time,
                pledge: this.profile.proof.size,
                timestamp: Date.now(),
                reward: null,
                nexus: [],
                txs: this.validTxs,
                key: this.profile.activeKeyPair.publicKeyArmored,
                spacePledged: this.spacePledged,
                immutableSpaceReserved: this.immutableStorageReserved,
                mutableSpaceReserved: this.mutableStorageReserved,
                costOfMutableStorage: this.costOfMutableStorage,
                costOfImmutableStorage: this.costOfImmutableStorage,
                signature: null
            }
        };
        block.value.reward = await this.createRewardTx();
        const nexusPayments = this.calculateNexusPayments();
        for (const payment of nexusPayments) {
            const nexusTx = await this.createNexusTx(payment.receiver, payment.amount, payment.contract);
            block.value.nexus.push(nexusTx);
        }
        block.value.signature = await crypto_1.default.sign(block.value, this.profile.activeKeyPair.privateKeyObject);
        block.key = crypto_1.default.getHash(JSON.stringify(block.value));
        return block;
    }
    async isValidBlock(block) {
        // has valid id (hash of value)
        if (!(crypto_1.default.isValidHash(block.key, JSON.stringify(block.value))))
            return false;
        let unsignedBlock = Object.assign({}, block.value);
        unsignedBlock.signature = null;
        // has valid signature
        if (!(await crypto_1.default.isValidSignature(JSON.stringify(unsignedBlock), block.value.signature, block.value.key)))
            return false;
        // references the last block
        if (block.value.lastBlock) {
            if (block.value.lastBlock !== this.chain[this.chain.length - 1])
                return false;
        }
        // solution is valid 
        if (!(await this.isValidSolution(block.value.solution, block.value.pledge, block.value.lastBlock, block.value.key)))
            return false;
        // timestamp is valid
        if (!(crypto_1.default.isDateWithinRange(block.value.timestamp, BLOCK_IN_MS)))
            return false;
        // validate the nexus txs
        for (const tx of block.value.nexus) {
            if (!(await this.onTx(tx)))
                return false;
        }
        // validate the reward tx
        if (!(await this.onTx(block.value.reward)))
            return false;
        // references valid txs (already received via gossip)
        for (const tx of block.value.txs) {
            if (!this.validTxs.includes(tx))
                return false;
        }
        // validate the cost of mutable storage
        // validate the cost of immutable storage
        // validate the space pledged
        // validate the space reserved
        return true;
    }
    async onBlock(block) {
        // called from core every time a new block is received via gossip
        // how do you know when you have the best block?
        // on block confirmation
        // remove all valid tx in this block
        // update the utxo/balances
        // is this a new block?
        if (this.validBlocks.includes(block.key) || this.invalidBlocks.includes(block.key))
            return false;
        // is the block valid?
        if (!(await this.isValidBlock(block))) {
            this.invalidBlocks.push(block.key);
            return false;
        }
        // is it the best solution proposed?
        if (!(await this.isBestSolution(block.value.lastBlock, block.value.solution))) {
            this.validBlocks.push(block.key);
            return false;
        }
        this.validBlocks.unshift(block.key);
        this.storage.put(block.key, JSON.stringify(block.value));
        return true;
    }
    async createTx(type = 'credit', address, amount = 0, script = null) {
        const tx = {
            key: null,
            value: {
                type: type,
                sender: this.profile.activeKeyPair.publicKeyArmored,
                receiver: address,
                amount: amount,
                fee: null,
                script: script,
                timeStamp: Date.now(),
                signature: null
            }
        };
        if (tx.value.type !== 'pledge') {
            tx.value.fee = this.calculateTxFee(tx);
            if (!((amount + tx.value.fee) <= this.getBalance(this.profile.hexId))) {
                throw new Error('insufficient funds for tx');
            }
        }
        tx.value.signature = await crypto_1.default.sign(tx.value, this.profile.activeKeyPair.privateKeyObject);
        tx.key = crypto_1.default.getHash(JSON.stringify(tx.value));
        return tx;
        // this balance will be reduced once the tx is added to the pool
    }
    async createPledgeTx(interval = 2628000000) {
        // pledge a new proof of space to the ledger
        const proof = this.profile.proof.id;
        const size = this.profile.proof.size;
        const pledge = { proof, size, interval };
        const tx = await this.createTx('pledge', null, 0, pledge);
        return tx;
    }
    async createContractTx(contract) {
        // reserve space on SSDB with a storage contract
        let cost;
        if (contract.ttl) { // mutable storage contract
            cost = this.costOfMutableStorage * contract.spaceReserved * contract.replicationFactor * contract.ttl;
        }
        else { // immutable storage contract
            cost = this.costOfImmutableStorage * contract.spaceReserved;
            contract.replicationFactor = Math.floor(Math.log2(this.hostCount));
        }
        const contractScript = {
            key: contract.publicKey,
            owner: contract.owner,
            size: contract.spaceReserved,
            ttl: contract.ttl,
            replicationFactor: contract.replicationFactor,
            signature: null
        };
        // sign with the private key of contract (not profile)
        contractScript.signature = await crypto_1.default.sign(contractScript, contract.privateKeyObject);
        // create the tx 
        const nexusAddress = crypto_1.default.getHash('nexus');
        const tx = await this.createTx('contract', nexusAddress, cost, contractScript);
        return tx;
    }
    async createRewardTx() {
        // create the coinbase tx or block reward on computing a block solution  
        const tx = {
            key: null,
            value: {
                type: 'reward',
                sender: null,
                receiver: this.profile.activeKeyPair.publicKeyArmored,
                amount: INITIAL_BLOCK_REWARD,
                fee: 0,
                script: null,
                timeStamp: Date.now(),
                signature: null
            }
        };
        // skip signing as we can validate the block hash
        tx.key = crypto_1.default.getHash(JSON.stringify(tx.value));
        return tx;
    }
    async createNexusTx(receiver, amount, contract) {
        const tx = {
            key: null,
            value: {
                type: 'nexus',
                sender: crypto_1.default.getHash('nexus'),
                receiver: receiver,
                amount: amount,
                fee: 0,
                script: contract,
                timeStamp: Date.now(),
                signature: null
            }
        };
        tx.value.fee = this.calculateTxFee(tx);
        tx.value.amount -= tx.value.fee;
        // skip signing sense we can validate the block hash
        tx.key = crypto_1.default.getHash(JSON.stringify(tx.value));
        return tx;
    }
    async isValidTx(tx) {
        // hash valid id (value hash)
        if (tx.key !== crypto_1.default.getHash(JSON.stringify(tx.value)))
            return false;
        // address has funds to cover amount + fees
        if (tx.value.type !== 'reward' && tx.value.type !== 'nexus') {
            if ((tx.value.amount + tx.value.fee) >= this.getBalance(crypto_1.default.getHash(tx.value.sender)))
                return false;
        }
        const preFeeTx = Object.assign({}, tx);
        preFeeTx.value.fee = null;
        preFeeTx.value.signature = null;
        // has correct tx fee
        if (tx.value.type !== 'pledge' && tx.value.type !== 'reward') {
            if (tx.value.fee !== this.calculateTxFee(preFeeTx))
                return false;
        }
        // has valid timestamp
        if (!(crypto_1.default.isDateWithinRange(tx.value.timeStamp, BLOCK_IN_MS)))
            return false;
        // validation for special tx types
        let valid;
        switch (tx.value.type) {
            case ('pledge'): valid = await this.isValidPledgeTx(tx);
            case ('contract'): valid = await this.isValidContractTx(tx);
            case ('nexus'): valid = await this.isValidNexusTx(tx);
            case ('reward'): valid = await this.isValidRewardTx(tx);
            default: valid = true;
        }
        if (!valid)
            return false;
        const preSignedTx = Object.assign({}, tx);
        preSignedTx.value.signature = null;
        // has valid signature
        if (tx.value.type !== 'nexus' && tx.value.type !== 'reward') {
            if (!(await crypto_1.default.isValidSignature(preSignedTx.value, tx.value.signature, tx.value.sender)))
                return false;
        }
        return true;
    }
    async isValidPledgeTx(tx) {
        // validate pledge (proof of space)
        const valid = await this.isValidProofofSpace(tx.value.sender, tx.value.script.size, tx.value.script.proof);
        if (!valid)
            return false;
        // size within range 10 GB to 1 TB
        if (!(tx.value.script.size >= MIN_PLEDGE_SIZE || tx.value.script.size <= MAX_PLEDGE_SIZE))
            return false;
        // payment interval within range one month to one year (ms)
        if (!(tx.value.script.interval >= MONTH_IN_MS || tx.value.script.interval <= YEAR_IN_MS))
            return false;
        return true;
    }
    async isValidContractTx(tx) {
        // deterimine if a given contract tx is valid 
        if (tx.value.script.ttl) { // mutable storage contract
            // validate TTL within range
            if (!(tx.value.script.ttl >= HOUR_IN_MS || tx.value.script.ttl <= YEAR_IN_MS))
                return false;
            // validate replicas within range
            if (!(tx.value.script.replicas >= 2 || tx.value.script.replicas <= Math.log2(this.hostCount)))
                return false;
            // validate size within range
            if (!(tx.value.script.size >= MIN_MUTABLE_CONTRACT_SIZE || tx.value.script.size <= MAX_MUTABLE_CONTRACT_SIZE))
                return false;
            // validate the cost 
            if (tx.value.amount !== (this.costOfMutableStorage * tx.value.script.size * tx.value.script.replicas * tx.value.script.ttl))
                return false;
        }
        else { // immutable storage contract
            // validate size within range
            if (!(tx.value.script.size >= MIN_IMMUTABLE_CONTRACT_SIZE || tx.value.script.size <= MAX_IMMUTABLE_CONTRACT_SIZE))
                return false;
            // validate the cost
            if (tx.value.amount !== (this.costOfImmutableStorage * tx.value.script.size * tx.value.script.replicas))
                return false;
        }
        // validate contract signature 
        const script = Object.assign({}, tx.value.script);
        script.signature = null;
        if (!(await crypto_1.default.isValidSignature(script, tx.value.script.signature, tx.value.script.key)))
            return false;
        return true;
    }
    isValidNexusTx(tx) {
        // does sender = nexus
        if (!(crypto_1.default.getHash('nexus') === tx.value.sender))
            return false;
        // does the recipient have a host contract?
        if (!this.contracts.has(tx.value.script))
            return false;
        // is the payment amount valid (later)
        return true;
    }
    isValidRewardTx(tx) {
        // has null sender
        if (!tx.value.sender === null)
            return false;
        // is less than or equal to 100 credits
        if (tx.value.amount === INITIAL_BLOCK_REWARD)
            return false;
        // is the block creator, how to know?
        // have to validate at block validation 
        return true;
    }
    async onTx(tx) {
        // called from core every time a new tx is received via gossip
        // is this a new tx?
        if (this.validTxs.includes(tx.key) || this.invalidTxs.includes(tx.key))
            return false;
        // it tx valid?
        if (!(await this.isValidTx(tx))) {
            this.invalidTxs.push(tx.key);
            return false;
        }
        const nexusAddress = crypto_1.default.getHash('nexus');
        switch (tx.value.type) {
            case ('credit'):
                // credit the recipient
                if (this.balances.has(tx.value.receiver)) {
                    let receiverBalance = this.balances.get(tx.value.receiver);
                    receiverBalance += tx.value.amount;
                    this.balances.set(tx.value.receiver, receiverBalance);
                }
                else {
                    this.balances.set(tx.value.receiver, tx.value.amount);
                }
                // debit the sender
                const senderAddress = crypto_1.default.getHash(tx.value.sender);
                let senderBalance = this.balances.get(senderAddress);
                senderBalance -= tx.value.amount;
                this.balances.set(senderAddress, senderBalance);
                break;
            case ('pledge'):
                // add the pledge to pledges
                this.pledges.set(tx.value.script.proof, {
                    host: tx.value.sender,
                    blockDue: Math.floor(tx.value.script.interval / 60000),
                    size: tx.value.script.size,
                    interval: tx.value.script.interval,
                    pledge: tx.key
                });
                // adjust space pledged
                this.spacePledged += tx.value.script.size;
                this.spaceAvailable += tx.value.script.size;
                break;
            case ('contract'):
                // add the contract to contracts
                this.contracts.set(crypto_1.default.getHash(tx.value.script.key), {
                    kind: 'contractData',
                    publicKey: tx.value.script.key,
                    clientKey: tx.value.sender,
                    spaceReserved: tx.value.script.size,
                    replicationFactor: tx.value.script.replicas,
                    ttl: tx.value.script.ttl,
                    createdAt: tx.value.timeStamp
                });
                // credit nexus
                if (this.balances.has(nexusAddress)) {
                    let nexusBalance = this.balances.get(nexusAddress);
                    nexusBalance += tx.value.amount;
                    this.balances.set(nexusAddress, nexusBalance);
                }
                else {
                    this.balances.set(nexusAddress, tx.value.amount);
                }
                // debit reserver
                const reserverAddress = crypto_1.default.getHash(tx.value.sender);
                let reserverBalance = this.balances.get(reserverAddress);
                reserverBalance -= tx.value.amount;
                this.balances.set(reserverAddress, reserverBalance);
                // adjust space reserved and available
                if (tx.value.script.ttl) {
                    this.mutableStorageReserved += tx.value.script.size;
                }
                else {
                    this.immutableStorageReserved += tx.value.script.size;
                }
                this.spaceAvailable -= tx.value.script.size;
                break;
            case ('nexus'):
                // debit nexus
                let nexusBalance = this.balances.get(nexusAddress);
                nexusBalance -= tx.value.amount;
                this.balances.set(nexusAddress, nexusBalance);
                // credit host 
                if (this.balances.has(tx.value.receiver)) {
                    let hostBalance = this.balances.get(tx.value.receiver);
                    hostBalance += tx.value.amount;
                    this.balances.set(tx.value.receiver, hostBalance);
                }
                else {
                    this.balances.set(tx.value.receiver, tx.value.amount);
                }
                break;
            case ('reward'):
                // credit the winner
                if (this.balances.has(tx.value.receiver)) {
                    let receiverBalance = this.balances.get(tx.value.receiver);
                    receiverBalance += tx.value.amount;
                    this.balances.set(tx.value.receiver, receiverBalance);
                }
                else {
                    this.balances.set(tx.value.receiver, tx.value.amount);
                }
                // update the credit supply
                this.creditSupply += tx.value.amount;
            default:
                // handle error
                break;
        }
        this.validTxs.push(tx.key);
        this.storage.put(tx.key, JSON.stringify(tx.value));
        return true;
    }
}
exports.default = Ledger;
//# sourceMappingURL=ledger.js.map