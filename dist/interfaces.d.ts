export interface IPledge {
    host: string;
    size: number;
    interval: number;
    proof: string;
    createdAt: number;
}
export interface IContract {
    publicKey: string;
    clientKey: string;
    spaceReserved: number;
    replicationFactor: number;
    ttl: number;
    createdAt: number;
}
