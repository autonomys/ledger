export declare class Farmer {
    constructor();
    isFarming: boolean;
    isPlotted: boolean;
    ledger: Ledger;
    plot: Plot;
    seedPlot(): Promise<void>;
    clearPlot(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export declare class Plot {
    constructor();
    plot: Map<any, any>;
    create(): void;
    createSeedList(): void;
    createSeedTre(): void;
    createProof(): void;
}
export declare class Ledger {
}
export declare class Block {
}
export declare class Tx {
}
