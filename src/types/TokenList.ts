import { Token } from './Token'

export interface TokenList {
    name: string
    logoURI: string
    keywords: string[]
    tags: object
    timestamp: string
    tokens: Token | { tags: string[] }[]
}
