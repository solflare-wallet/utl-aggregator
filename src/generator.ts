import axios from 'axios'
import axiosRetry from 'axios-retry'

import { Provider, Tag, Token } from './providers'

export class Generator {
    constructor(private readonly standardSources: Provider[]) {}

    private static upsertTokenMints(
        tokenMints: Map<string, Token>,
        newTokenMints: Map<string, Token>
    ) {
        for (const [mintAddress, token] of newTokenMints) {
            const currentToken = tokenMints.get(mintAddress)
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
                tokenMints.set(mintAddress, currentToken)
            } else {
                tokenMints.set(mintAddress, token)
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

        const tokenMap = new Map<string, Token>()

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

    async generateTokenList(chainId: number) {
        const tokensMap = await this.generateTokens()
        const tokensArray = Array.from(tokensMap.values())

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
            tokens: tokensArray.map((token) => {
                return { ...token, chainId, tags: [...token.tags] }
            }),
        }
    }
}
