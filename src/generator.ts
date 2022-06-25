import axios from 'axios'
import axiosRetry from 'axios-retry'

import { Provider } from './providers'
import { Tag, TokenSet, TokenList } from './types'

export class Generator {
    constructor(private readonly standardSources: Provider[]) {}

    private static upsertTokenMints(
        tokenMints: TokenSet,
        newTokenMints: TokenSet
    ) {
        for (const token of newTokenMints.tokens()) {
            token.logoURI = Generator.sanitizeUrl(token.logoURI)

            const currentToken = tokenMints.getByToken(token)
            if (currentToken) {
                if (!currentToken.decimals && token.decimals) {
                    currentToken.decimals = token.decimals
                }
                if (!currentToken.logoURI && token.logoURI) {
                    currentToken.logoURI = token.logoURI
                }
                if (!currentToken.tags && token.tags) {
                    currentToken.tags = token.tags
                }
                if (!currentToken.holders && token.holders) {
                    currentToken.holders = token.holders
                }
                tokenMints.set(currentToken)
            } else {
                tokenMints.set(token)
            }
        }
    }

    async generateTokens() {
        axiosRetry(axios, {
            retries: 3,
            retryDelay: (retryCount) => {
                return retryCount * 1000
            },
        })

        const tokenMap = new TokenSet()

        let min = 0
        const id = setInterval(() => {
            console.log(`====> Minute: ${++min}`)
        }, 60 * 1000)

        const results = await Promise.allSettled(
            this.standardSources.map((source) => source.getTokens())
        )

        for (const result of results) {
            if (result.status === 'fulfilled') {
                Generator.upsertTokenMints(tokenMap, result.value)
            } else {
                throw new Error(`Generate failed ${result.reason}`)
            }
        }

        clearInterval(id)

        return tokenMap
    }

    async generateTokenList(): Promise<TokenList> {
        const tokensMap = await this.generateTokens()

        const tags: object = {}
        const tagNames = Object.values(Tag)

        for (const tag of tagNames) {
            tags[tag] = {
                name: tag,
                description: '',
            }
        }

        return {
            name: 'Solana Token List',
            logoURI: '',
            keywords: ['solana', 'spl'],
            tags,
            timestamp: new Date().toISOString(),
            tokens: tokensMap.tokens(),
        }
    }

    private static sanitizeUrl(string) {
        let url

        try {
            url = new URL(string)
        } catch (_) {
            return null
        }

        return url.protocol === 'http:' || url.protocol === 'https:'
            ? url
            : null
    }
}
