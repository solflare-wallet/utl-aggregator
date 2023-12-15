import axios, { AxiosPromise } from 'axios'
import * as console from 'console'
import _ from 'lodash'

import { Tag, TokenSet } from '../types'
import {
    RpcRequestAccountInfo,
    RpcRequestHolders,
    RpcRequestSignature,
    RpcResponseAccountInfo,
    RpcResponseHolders,
    RpcResponseSignature,
} from '../utils/rpc'

import { Provider } from './Provider'

interface LegacyListToken {
    chainId: number
    name: string
    symbol: string
    logoURI: string
    tags: Tag[]
    address: string
}

interface LegacyList {
    tokens: LegacyListToken[]
}

const LARGEST_MINTS = [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6', // KIN
    'XzR7CUMqhDBzbAm4aUNvwhVCxjWGn1KEvqTp3Y8fFCD', // SCAM
    'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB', // GST
    'CKaKtYvz6dKPyMvYq9Rh3UBrnNqYZAyd7iF4hJtjUvks', // GARI
    'xxxxa1sKNGwFtw2kFn8XauW9xq8hBZ5kVtcSesTT9fW', // SLIM
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx', // GMT
    'foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG', // FOOOOOOD,
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY,
    'So11111111111111111111111111111111111111112', // SOL,
    '9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM', // AUDIO
]

interface ThrottleOptions {
    throttle: number
    batchSignatures: number
    batchAccountsInfo: number
    batchTokenHolders: number
}

export class ProviderLegacyToken extends Provider {
    constructor(
        private readonly cdnUrl: string,
        private readonly rpcUrl: string,
        private readonly throttleOpts: ThrottleOptions = {
            throttle: 0, // Add sleep after batch RPC request to avoid rate limits
            batchSignatures: 100, // Batch RPC calls in single RPC request
            batchAccountsInfo: 250, // Batch RPC calls in single RPC request
            batchTokenHolders: 5, // Batch parallel RPC requests
        },
        private readonly skipTags: Tag[], // Filter out specific tags
        private readonly chainId: number = 101, // Filter by chain id
        private readonly signatureDays = 30, // Filter tokens by last signature date
        private readonly minHolders = 100 // Filter tokens by number holders
    ) {
        super()
    }

    async getTokens(): Promise<TokenSet> {
        const tokenMap = new TokenSet()

        const tokens = await axios.get<LegacyList>(this.cdnUrl)
        for (let i = 0; i < tokens.data.tokens.length; i++) {
            const token: LegacyListToken = tokens.data.tokens[i]

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
                    decimals: null,
                    logoURI: token.logoURI,
                    tags: new Set<Tag>(token.tags),
                    verified: true,
                    holders: null,
                })
            }
        }

        await this.removeByContent(tokenMap, [
            'scam',
            'phishing',
            'please ignore',
        ])
        await this.filterAccountInfo(tokenMap)
        await this.filterLatestSignature(tokenMap)
        await this.filterHolders(tokenMap)
        return tokenMap
    }

    /**
     * Remove tokens by their content
     * @param tokenMap
     * @param contentArray
     */
    removeByContent(tokenMap: TokenSet, contentArray: string[]) {
        for (const token of tokenMap.tokens()) {
            for (const content of contentArray) {
                if (token.name.toLowerCase().includes(content.toLowerCase())) {
                    tokenMap.deleteByToken(token)
                }
                if (
                    token.symbol.toLowerCase().includes(content.toLowerCase())
                ) {
                    tokenMap.deleteByToken(token)
                }
            }
        }
    }

    /**
     * Filter by account info
     * and fetch decimals
     * @param tokenMap
     */
    async filterAccountInfo(tokenMap: TokenSet) {
        // Batch RPC calls
        let rpcCalls: object[] = []
        for (const mint of tokenMap.mints()) {
            rpcCalls.push(RpcRequestAccountInfo(mint))
        }

        // Chunk batched requests
        while (rpcCalls.length > 0) {
            let progress = 0
            const chunks = _.chunk(
                rpcCalls,
                this.throttleOpts.batchAccountsInfo
            )
            rpcCalls = []
            for (const dataChunk of chunks) {
                console.log(
                    `[LTL] filter by account info ${++progress}/${
                        chunks.length
                    }`
                )

                const response = await axios.post<RpcResponseAccountInfo[]>(
                    this.rpcUrl,
                    dataChunk
                )

                console.log(
                    `[LTL] filter by account info ${++progress}/${
                        chunks.length
                    }`
                )

                for (const mintResponse of response.data) {
                    // Remove token if not a mint
                    if (
                        !mintResponse.result ||
                        !mintResponse.result.value ||
                        !mintResponse.result.value.data['parsed'] ||
                        !mintResponse.result.value.data['program'] ||
                        (mintResponse.result.value.data.program !==
                            'spl-token' &&
                            mintResponse.result.value.data.program !==
                                'spl-token-2022') ||
                        mintResponse.result.value.data.parsed.type !== 'mint'
                    ) {
                        if (!mintResponse.result) {
                            console.log(
                                `[LTL] filter by account mint ${mintResponse.id} no result (chainId: ${this.chainId})`
                            )
                            rpcCalls.push(
                                RpcRequestAccountInfo(mintResponse.id)
                            )
                        } else {
                            tokenMap.deleteByMint(mintResponse.id, this.chainId)
                        }
                        continue
                    }

                    // Update decimals for token
                    const token = tokenMap.getByMint(
                        mintResponse.id,
                        this.chainId
                    )
                    if (token) {
                        token.decimals =
                            mintResponse.result.value.data.parsed.info.decimals
                        tokenMap.set(token)
                    }
                }

                if (this.throttleOpts.throttle > 0) {
                    await new Promise((f) =>
                        setTimeout(f, this.throttleOpts.throttle)
                    )
                }
            }
            if (rpcCalls.length > 0) {
                console.log(
                    `[LTL] filter by account mint, retry ${rpcCalls.length} failed requests (chainId: ${this.chainId})`
                )
            }
        }
    }

    /**
     * Remove inactive tokens by their
     * latest signature from RPC
     * @param tokenMap
     */
    async filterLatestSignature(tokenMap: TokenSet) {
        // Get cached recent signatures, so we can skip RPC requests for them.
        let cachedRecentSignatures = new Map<string, number>()
        try {
            cachedRecentSignatures = new Map<string, number>(
                Object.entries(
                    JSON.parse(
                        Provider.readCachedJSON(
                            ProviderLegacyToken.cacheKeyRecentSignatures(
                                this.chainId
                            )
                        )
                    )
                )
            )
            console.log('[LTL] Use cache for recent signatures')
        } catch (e) {
            console.log('[LTL] No cache for recent signatures')
        }

        // Calculate minimum unix timestamp
        const date =
            Math.ceil(Date.now() / 1000) - this.signatureDays * 24 * 60 * 60

        // Batch latest signature calls
        let rpcCalls: object[] = []
        for (const mint of tokenMap.mints()) {
            const cached = cachedRecentSignatures.get(mint)
            if (cached && cached > date) {
                continue
            }

            rpcCalls.push(RpcRequestSignature(mint))
        }

        while (rpcCalls.length > 0) {
            // Chunk batches
            let progress = 0
            const chunks = _.chunk(rpcCalls, this.throttleOpts.batchSignatures)
            rpcCalls = []
            for (const dataChunk of chunks) {
                console.log(
                    `[LTL] filter by signature ${++progress}/${
                        chunks.length
                    } (chainId: ${this.chainId})`
                )

                const response = await axios.post<RpcResponseSignature[]>(
                    this.rpcUrl,
                    dataChunk
                )

                for (const mintResponse of response.data) {
                    if (
                        !mintResponse.result ||
                        !mintResponse.result.length ||
                        mintResponse.result[0].blockTime < date
                    ) {
                        if (!mintResponse.result) {
                            console.log(
                                `[LTL] filter by signature mint ${mintResponse.id} no result, retry (chainId: ${this.chainId})`
                            )
                            rpcCalls.push(RpcRequestSignature(mintResponse.id))
                        } else {
                            tokenMap.deleteByMint(mintResponse.id, this.chainId)
                        }
                    } else {
                        cachedRecentSignatures.set(
                            mintResponse.id,
                            mintResponse.result[0].blockTime
                        )
                    }
                }

                if (this.throttleOpts.throttle > 0) {
                    await new Promise((f) =>
                        setTimeout(f, this.throttleOpts.throttle)
                    )
                }
            }
            if (rpcCalls.length > 0) {
                console.log(
                    `[LTL] filter by signature, retry ${rpcCalls.length} failed requests (chainId: ${this.chainId})`
                )
            }
        }

        Provider.saveCachedJSON(
            ProviderLegacyToken.cacheKeyRecentSignatures(this.chainId),
            JSON.stringify(Object.fromEntries(cachedRecentSignatures))
        )
    }

    /**
     * Remove tokens with few accounts
     * @param tokenMap
     */
    async filterHolders(tokenMap: TokenSet) {
        // Get cached largest tokens, so we can skip RPC requests for them.
        let cachedLargeTokens = new Map<string, number>()
        try {
            cachedLargeTokens = new Map<string, number>(
                Object.entries(
                    JSON.parse(
                        Provider.readCachedJSON(
                            ProviderLegacyToken.cacheKeyLargeAccounts(
                                this.chainId
                            )
                        )
                    )
                )
            )
            console.log('[LTL] Use cache for large mints')
        } catch (e) {
            console.log('[LTL] No cache for large mints')
        }

        const mints = tokenMap.mints()

        const mintToCheck: string[] = []
        for (const mint of mints) {
            if (LARGEST_MINTS.includes(mint) || cachedLargeTokens.has(mint)) {
                const token = tokenMap.getByMint(mint, this.chainId)
                if (token) {
                    token.holders = LARGEST_MINTS.includes(mint)
                        ? 100000
                        : (cachedLargeTokens.get(mint) as number)
                    tokenMap.set(token)
                }
                continue
            }
            mintToCheck.push(mint)
        }

        // Chunk them so we can parallel send multiple RPC requests
        let progress = 0
        const batches = _.chunk(
            mintToCheck,
            this.throttleOpts.batchTokenHolders
        )

        for (const batch of batches) {
            console.log(
                `[LTL] filter by holder ${++progress}/${batches.length}`
            )

            const requests: AxiosPromise[] = []

            for (const mint of batch) {
                requests.push(
                    axios.post<RpcResponseHolders>(
                        this.rpcUrl,
                        RpcRequestHolders(mint)
                    )
                )
            }

            // Wait for batch of axios request to finish
            const responses = await Promise.allSettled(requests)
            for (const response of responses) {
                if (response.status === 'fulfilled') {
                    const mint = response.value.data.id
                    let count = 0

                    if (response.value.data.error) {
                        console.log(
                            `[LTL] Failed RPC holders call for ${mint}`,
                            response.value.data
                        )

                        if (
                            response.value.data.error &&
                            response.value.data.error.data.includes(
                                'Exceeded max limit'
                            )
                        ) {
                            count = 100000
                        } else {
                            console.log(`[LTL] Skip holder check for ${mint}`)
                            continue
                        }
                    }

                    count = response.value.data.result.length

                    if (count < this.minHolders) {
                        tokenMap.deleteByMint(mint, this.chainId)
                        continue
                    }

                    if (count >= 1000) {
                        cachedLargeTokens.set(mint, count)
                        Provider.saveCachedJSON(
                            ProviderLegacyToken.cacheKeyLargeAccounts(
                                this.chainId
                            ),
                            JSON.stringify(
                                Object.fromEntries(cachedLargeTokens)
                            )
                        )
                    }

                    // Update decimals for token
                    const token = tokenMap.getByMint(mint, this.chainId)
                    if (token) {
                        token.holders = count
                        tokenMap.set(token)
                    }
                } else {
                    throw new Error(
                        `Failed to fetch holders: ${response.reason}`
                    )
                }
            }

            if (this.throttleOpts.throttle > 0) {
                await new Promise((f) =>
                    setTimeout(f, this.throttleOpts.throttle)
                )
            }
        }
    }

    public static clearCache(chainId: number) {
        this.removeCachedJSON(
            ProviderLegacyToken.cacheKeyLargeAccounts(chainId)
        )
        this.removeCachedJSON(
            ProviderLegacyToken.cacheKeyRecentSignatures(chainId)
        )
    }

    private static cacheKeyLargeAccounts(chainId: number) {
        return `legacy-list-large-mints-${chainId}`
    }

    private static cacheKeyRecentSignatures(chainId: number) {
        return `legacy-list-recent-signatures-${chainId}`
    }
}
