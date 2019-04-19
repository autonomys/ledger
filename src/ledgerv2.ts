import * as crypto from '@subspace/crypto'
import { create } from 'domain';

export class Farmer {

  constructor() {}

  isFarming = false
  isPlotted = false
  
  ledger: Ledger = null
  plot: Plot = null

  public async seedPlot() {
    // iteratively hash my public key to generate my plot seeds, then organize into a merkle tree 
    // create a plot of proofs for each seed 
    // create a lookup table of proofHashes and seeds 
  }

  public async clearPlot() {}

  public async start() {}

  public async stop() {}
}

export class Plot {
  constructor() {}
  
  plot = new Map()

  create() {}

  createSeedList() {}

  createSeedTre() {}

  createProof() {} 

}

// Ledger would have it's own wallet if it used BLS signatures

export class Ledger {

}

export class Block {

}

export class Tx {

}