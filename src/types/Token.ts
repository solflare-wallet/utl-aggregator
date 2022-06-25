import { ChainId, Tag } from './index'

export interface Token {
    address: string
    chainId: ChainId
    name: string
    symbol: string
    logoURI: string | null
    verified: boolean
    tags: Set<Tag>
    decimals: number | null
    holders: number | null
}
