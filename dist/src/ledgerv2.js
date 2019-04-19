"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Farmer {
    constructor() {
        this.isFarming = false;
        this.isPlotted = false;
        this.ledger = null;
        this.plot = null;
    }
    async seedPlot() {
        // iteratively hash my public key to generate my plot seeds, then organize into a merkle tree 
        // create a plot of proofs for each seed 
        // create a lookup table of proofHashes and seeds 
    }
    async clearPlot() { }
    async start() { }
    async stop() { }
}
exports.Farmer = Farmer;
class Plot {
    constructor() {
        this.plot = new Map();
    }
    create() { }
    createSeedList() { }
    createSeedTre() { }
    createProof() { }
}
exports.Plot = Plot;
// Ledger would have it's own wallet if it used BLS signatures
class Ledger {
}
exports.Ledger = Ledger;
class Block {
}
exports.Block = Block;
class Tx {
}
exports.Tx = Tx;
//# sourceMappingURL=ledgerv2.js.map