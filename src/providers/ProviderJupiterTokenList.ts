import axios from 'axios'
import console from 'console'

import { ChainId, Tag, Token, TokenSet } from '../types'

import { Provider } from './index'

type JupiterToken = {
    address: string
    chainId: ChainId
    name: string
    symbol: string
    logoURI: string
    tags: string[]
    decimals: number
    extensions?: {
        coingeckoId: string
    }
}
export class ProviderJupiterTokenList extends Provider {
    constructor(private readonly listUrl: string) {
        super()
    }

    async getTokens(): Promise<TokenSet> {
        const tokenMap = new TokenSet('JupiterProvider')
        console.log(`[JUP] fetch list`)
        const tokens = await axios.get<JupiterToken[]>(this.listUrl)
        console.log(`[JUP] fetched list`)
        for (let i = 0; i < tokens.data.length; i++) {
            const token = tokens.data[i]

            const t: Token = {
                chainId: ChainId.MAINNET,
                name: token.name,
                symbol: token.symbol.toUpperCase(),
                address: token.address,
                decimals: token.decimals,
                logoURI: token.logoURI,
                tags: new Set<Tag>([...(token.tags as Tag[]), Tag.JUPITER]),
                verified:
                    token.tags.includes('verified') ||
                    token.tags.includes('strict'),
                holders: null,
                extensions: token.extensions?.coingeckoId
                    ? {
                          coingeckoId: token.extensions.coingeckoId,
                      }
                    : undefined,
            }

            tokenMap.set(t)
        }
        console.log(`[JUP] imported list`)
        return tokenMap
    }
}
