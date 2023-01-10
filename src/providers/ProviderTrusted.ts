import axios from 'axios'
import console from 'console'
import _ from 'lodash'

import { Tag, TokenSet } from '../types'

import { Provider } from './Provider'

interface TrustedListToken {
    chainId: number
    name: string
    symbol: string
    decimals: number
    logoURI: string
    tags: Tag[]
    address: string
}

interface TrustedList {
    tokens: TrustedListToken[]
}

export class ProviderTrusted extends Provider {
    constructor(
        private readonly url: string,
        private readonly skipTags: Tag[], // Filter out specific tags
        private readonly chainId: number = 101 // Filter by chain id
    ) {
        super()
    }

    async getTokens(): Promise<TokenSet> {
        const tokenMap = new TokenSet()

        const tokens = await axios.get<TrustedList>(this.url)
        for (let i = 0; i < tokens.data.tokens.length; i++) {
            const token: TrustedListToken = tokens.data.tokens[i]

            // Get only tokens for mainnet and devnet
            if (
                this.chainId === token.chainId &&
                !_.intersection(token.tags, this.skipTags).length
            ) {
                tokenMap.set({
                    chainId: token.chainId,
                    name: token.name,
                    symbol: token.symbol,
                    address: token.address,
                    decimals: token.decimals,
                    logoURI: token.logoURI,
                    tags: new Set<Tag>(token.tags),
                    verified: true,
                    holders: null,
                })
            }
        }

        console.log(`[TL] Loaded tokens from ${this.url} - ${this.chainId}`)
        return tokenMap
    }
}
