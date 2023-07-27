import axios from 'axios'
import axiosRetry from 'axios-retry'

import { Provider } from './providers'
import { Tag, TokenSet, TokenList } from './types'

export class Generator {
    constructor(
        private readonly standardSources: Provider[],
        private readonly ignoreSources: Provider[]
    ) {}

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

    private static removeTokenMints(
        tokenMints: TokenSet,
        newTokenMints: TokenSet
    ) {
        for (const token of newTokenMints.tokens()) {
            tokenMints.deleteByToken(token)
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

        try {
            // Add tokens from standard sources
            const results = await Promise.allSettled(
                this.standardSources.map((source) => source.getTokens())
            )
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    Generator.upsertTokenMints(tokenMap, result.value)
                } else {
                    console.log(`Generate failed ${result.reason}`)
                    throw new Error(`Generate standard failed ${result.reason}`)
                }
            }

            // Remove tokens from ignore sources
            const resultsIgnore = await Promise.allSettled(
                this.ignoreSources.map((source) => source.getTokens())
            )
            for (const result of resultsIgnore) {
                if (result.status === 'fulfilled') {
                    Generator.removeTokenMints(tokenMap, result.value)
                } else {
                    console.log(`Generate failed ${result.reason}`)
                    throw new Error(`Generate ignore failed ${result.reason}`)
                }
            }
        } catch (e) {
            clearInterval(id)
            throw e
        }

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
            tokens: tokensMap.tokens().map((token) => {
                return { ...token, tags: [...token.tags] }
            }),
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
