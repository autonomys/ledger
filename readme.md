# Subspace Ledger Module

A mock proof of space ledger for completeness.

## External Usage

Install this module as a dependency into another project

```
$ yarn add https://www.github.com/subspace/ledger.git
```

Require this module inside a script

```javascript
const ledger = require('@subspace/ledger')
```


## API

### ledger.createProof(key: string, space: integer) proof: object
Generates a simple *representative* proof of space by iteratively hashing a nodes public key, once for each MB pledged, or 1000 times for a gigabyte of storage. The hashes are sorted into a binary tree and stored as solutions to the block challenge.

* `key` - string encoed 32 byte ECDSA public key
* `space` - amount of space to be pledged in GB

Returns a proof of space.


### ledger.ValidateProof()

Pledges are validated ineffeciently by recreating the full proof at each node.


### ledger.createTx()

Create a tx locally to transfer credits from your address to another address.

### ledger.validateTx()

Validate a tx submitted before including a block or when validating a block contents.

```javascript


```

### ledger.createContract()

Locks earned subspace credits into a storage contract and publishes as a tx

```javascript

```

### ledger.validateContract()

Validates if a pending or published contract is valid

```javascript

```

### ledger.getBlockSolution()

Searches the local proofs for the best block solution to start building a new block in response to a new valid published block.

```javascript

```

### legder.validateBlockSolution()

Validates that a block solution is valid for a given public key

```javascript

```

### publishBlock()

Publishes the current block 1 minute after last block is published

### validateBlock()

Validates a received block

### saveBlock()

Saves a valid block to local storage

### computeUtxo()

Computes the UTXO balance for all addresses

### getBalance()

Get's current UTXO balance for an address

### ledger.on('block')

Validates the block and solution. If valid finds the best solution to the next block and listens for transactions to add.

### ledger.on('tx')

Validates tx's and adds them to the current block.

## Development Use

Clone and install the repo locally   

```
$ git clone https://www.github.com/subspace/ledger
$ cd ledger
$ yarn
```

Start writing code in src/main.ts

Build manually:  

```
$ npm run build
```

Watch for file changes:

```
$ npm run watch
```

[Instructions](https://code.visualstudio.com/docs/languages/typescript#_step-2-run-the-typescript-build) to automate with visual studio code.

## Testing

Write tests in src/main.tests.ts (example provided) and run with

```
$ npx jest
```



