 export interface IPledge {
  host: string
  size: number
  interval: number
  proof: string
  createdAt: number
}

export interface IContract {
  id: string
  createdAt: number
  spaceReserved: number
  replicationFactor: number
  ttl: number
  contractSig: string
}
