# Subspace Ledger Module

A mock proof of space ledger for completeness.

## Development Use

Clone and install the repo locally   

```
$ git clone https://www.github.com/subspace/ledger
$ cd ledger
$ yarn
```

Start writing code in src/main.ts

Build manually.  
This will create an entry point at dist/main.js
 
```
$ tsc -w
```

[Instructions](https://code.visualstudio.com/docs/languages/typescript#_step-2-run-the-typescript-build) to automate with visual studio code.

## Testing

Write tests in src/main.tests.ts (example provided) and run with

```
$ npx jest
```

## External Usage

Install this module as a dependency into another project

```
$ yarn add https://www.github.com/subspace/ledger.git
```

Require this module inside a script

```javascript
const ledger = require('ledger').default
```


## API

### ledger.createProof()

Generates a simple *representative* proof of space by iteratively hashing a nodes public key, once for each MB pledged, or 1000 times for a gigabyte of storage. The hashes are sorted into a binary tree and stored as solutions to the block challenge.

```javascript
createProof(key, space) => {
  const proofArray = []
  const hashCount = space * 1000
  for (i = 0; i < hashCount; i++) {
    key = crypto.getHash(key)
    proofArray.push(key)
  }
  const proofHash = crytpo.getHash(proofArray.toString())
  return { proofHash, proofArray }
}
```

### ledger.ValidateProof()

Pledges are validated ineffeciently by recreating the full proof at each node.

```javascript
validateProof(key, space, proof) => {
  if (this.createProof(key, space) === proof) {
    return true
  } else {
    return false
  }
}
```

### ledger.createTx()

Create a tx locally to transfer credits from your address to another address.

```javascript
createTx(dst, amount) => {

  if (!amount <= this.getBalance(profile.hexId) ) {
    return false
  }

  this.debitBalance(profile.hexId, amount, fee)

  let value = {
    sender: profile.hexId,
    key: profile.publicKey,
    receiver: dst,
    amount: amount,
    fee: fee,
    timeStamp: new Date(),
    signature: null
  }

  let signature = crypto.sign(value, profile)
  let value.signature = signature
  let key = crypto.getHash(JSON.stringify(value))
  let tx = { key, value }
  return tx 
}
```

### ledger.validateTx()

Validate a tx submitted before including a block or when validating a block contents.

```javascript
validateTx(tx) => {

  // check hash
  if (!tx.key === crypto.getHash(JSON.stringify(tx.value))) {
    return false
  }

  // check funds
  if (!amount <= this.getBalance(tx.sender)) {
    return false
  }

  // check timestamp
  if (!crypto.verifyDate(tx.timestamp, 600000)) {
    return false
  }

  // check signature
  let value = {
    sender: tx.value.sender,
    key: tx.value.key,
    receiver: tx.value.receiver,
    amount: tx.value.amount,
    fee: tx.value.fee,
    timeStamp: tx.value.timeStamp,
    signature: null
  }

  if (!crypto.verifySignature(value, tx.value.signature, tx.value.key)) {
    return false
  }

  return true
}

```

### ledger.createContract()

Locks earned subspace credits into a storage contract and publishes as a tx

```javascript
async createContract(size) => {

  // calculate cost in subspace credits
  let cost = size * this.costofStorage

  // check funds
  if (!this.getBalance(profile.hexId) >= cost) {
    return false
  }

  // generate contract key pair 
  const options = {
    userIds: [ { 
      name: 'name',
      email: 'email'
    } ],
    curve: 'ed25519',
    passphrase: 'passphrase'
  }
  
  const keys = await crypto.generateKeys(options)
  profile.contracts.push(keys)

  // construct the contract object 

  let value = {
    sender: profile.hexId,
    senderKey: profile.publicKey,
    receiver: this.nexusAddress,
    contractKey: keys.publicKeyArmored,
    amount: cost,
    fee: fee,
    size: size,
    inetrval: 2628000000,
    timeStamp: new Date(),
    senderSignature: null,
    contractSignature: null
  }

  let value.senderSignature = crypto.sign(value, profile)
  let value.contractSignature = crypto.sign(value, keys)
  let key = crypto.getHash(value)
  let contract = { key, value }
  return contract
}
```

### ledger.validateContract()

Validates if a pending or published contract is valid

```javascript
validateContract(contract) => {

  // check hash
  if (!contract.key === crypto.getHash(JSON.stringify(contract.value))) {
    return false
  }

  // check funds
  if (!amount <= this.getBalance(contract.sender)) {
    return false
  }

  // check timestamp
  if (!crypto.verifyDate(contract.timestamp, 600000)) {
    return false
  }

  // check sender signature
  let value = {
    sender: contract.value.sender,
    senderKey: contract.value.senderKey,
    receiver: contract.value.receiver,
    contractKey: contract.value.contractKey,
    amount: contract.value.amount,
    size: contract.value.size,
    inetrval: contract.value.interval,
    timeStamp: contract.value.timeStamp,
    senderSignature: null,
    contractSignature: null
  }

  if (!crypto.verifySignature(value, contract.value.senderSignature, contract.value.senderKey)) {
    return false
  }

  // check signature
  let value = {
    sender: contract.value.sender,
    senderKey: contract.value.senderKey,
    receiver: contract.value.receiver,
    contractKey: contract.value.contractKey,
    amount: contract.value.amount,
    size: contract.value.size,
    inetrval: contract.value.interval,
    timeStamp: contract.value.timeStamp,
    senderSignature: contracrt.value.senderSignature,
    contractSignature: null
  }

  if (!crypto.verifySignature(value, contract.value.contractSigature, contract.value.contractKey)) {
    return false
  }

  return true

}
```

### ledger.getBlockSolution()

Searches the local proofs for the best block solution to start building a new block in response to a new valid published block.

```javascript
getBlockSolution(blockHash, proofArray) => {
  let bestSolution = buffer.from('fffffffffffffffffffffffffffffffff', 'hex')
  for (i = 0; i < proofArray.length; i ++) {
    const solution = crypto.getXorDistance(proofArray[i], blockHash)
    if (solution < bestSolution) {
      bestSoluton = solution
    }
  }
  return bestSolution
}
```

### legder.validateBlockSolution()

Validates that a block solution is valid for a given public key

```javascript
validateBlockSolution(solution, blockHash, publicKey) => {
  const proof = this.createProof(publicKey)
  const solution = getBlockSolution(blockHash, proofs.proofArray)
  if (solution === bestSolution) {
    return true
  } else {
    return false
  }
}
```

### publishBlock()

Publishes the current block 1 minute after last block is published

### validateBlock()

Validates a received block

### saveBlock()

Saves a valid block to local storage

### computeBalances()

Computes the UTXO balance for all addresses

### getBalance()

Get's current UTXO balance for an address

### ledger.on('block')

Validates the block and solution. If valid finds the best solution to the next block and listens for transactions to add.

### ledger.on('tx')

Validates tx's and adds them to the current block.





