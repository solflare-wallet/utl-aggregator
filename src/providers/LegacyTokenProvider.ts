import axios, { AxiosPromise } from 'axios'
import _ from 'lodash'

import { Provider, Tag, Token } from './provider'
import {
    RpcRequestAccountInfo,
    RpcRequestHolders,
    RpcRequestSignature,
    RpcResponseAccountInfo,
    RpcResponseHolders,
    RpcResponseSignature,
} from './utils/rpc'

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

const LARGEST_MINST = [
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
    'So11111111111111111111111111111111111111112', // SOL
]

interface ThrottleOptions {
    throttle: number
    batchSignatures: number
    batchAccountsInfo: number
    batchTokenHolders: number
}

export class LegacyTokenProvider extends Provider {
    private static readonly _cacheKeyLargeAccounts = 'legacy-list-large-mints'
    private static readonly _cacheKeyRecentSignatures =
        'legacy-list-recent-signatures'

    constructor(
        private readonly cdnUrl: string,
        private readonly rpcUrl: string,
        private readonly throttleOpts: ThrottleOptions = {
            throttle: 0, // Add sleep after batch RPC request to avoid rate limits
            batchSignatures: 100, // Batch RPC calls in single RPC request
            batchAccountsInfo: 250, // Batch RPC calls in single RPC request
            batchTokenHolders: 5, // Batch parallel RPC requests
        },
        private readonly chainId: number = 101, // Filter by chain id
        private readonly signatureDays = 30, // Filter tokens by last signature date
        private readonly minHolders = 100 // Filter tokens by number holders
    ) {
        super()
    }

    async getTokens(): Promise<Map<string, Token>> {
        const tokenMap = new Map<string, Token>()

        const tokens = await axios.get<LegacyList>(this.cdnUrl)
        for (let i = 0; i < tokens.data.tokens.length; i++) {
            const token: LegacyListToken = tokens.data.tokens[i]

            // Get only tokens for mainnet and devnet
            if (this.chainId === token.chainId) {
                tokenMap.set(token.address, {
                    name: token.name,
                    symbol: token.symbol,
                    address: token.address,
                    decimals: null,
                    logoURI: token.logoURI,
                    tags: new Set<Tag>(token.tags),
                    verified: true,
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
    removeByContent(tokenMap: Map<string, Token>, contentArray: string[]) {
        for (const [mintAddress, token] of tokenMap) {
            for (const content of contentArray) {
                if (token.name.toLowerCase().includes(content.toLowerCase())) {
                    tokenMap.delete(mintAddress)
                }
                if (
                    token.symbol.toLowerCase().includes(content.toLowerCase())
                ) {
                    tokenMap.delete(mintAddress)
                }
            }
        }
    }

    /**
     * Filter by account info
     * and fetch decimals
     * @param tokenMap
     */
    async filterAccountInfo(tokenMap: Map<string, Token>) {
        // Batch RPC calls
        const rpcCalls: object[] = []
        for (const mint of tokenMap.keys()) {
            rpcCalls.push(RpcRequestAccountInfo(mint))
        }

        // Chunk batched requests
        let progress = 0
        const chunks = _.chunk(rpcCalls, this.throttleOpts.batchAccountsInfo)
        for (const dataChunk of chunks) {
            console.log(
                `[LTL] filter by account info ${++progress}/${chunks.length}`
            )

            const response = await axios.post<RpcResponseAccountInfo[]>(
                this.rpcUrl,
                dataChunk
            )

            for (const mintResponse of response.data) {
                // Remove token if not a mint
                if (
                    !mintResponse.result.value ||
                    !mintResponse.result.value.data['parsed'] ||
                    !mintResponse.result.value.data['program'] ||
                    mintResponse.result.value.data.program !== 'spl-token' ||
                    mintResponse.result.value.data.parsed.type !== 'mint'
                ) {
                    tokenMap.delete(mintResponse.id)
                    continue
                }

                // Update decimals for token
                const token = tokenMap.get(mintResponse.id)
                if (token) {
                    token.decimals =
                        mintResponse.result.value.data.parsed.info.decimals
                    tokenMap.set(mintResponse.id, token)
                }
            }

            if (this.throttleOpts.throttle > 0) {
                await new Promise((f) =>
                    setTimeout(f, this.throttleOpts.throttle)
                )
            }
        }
    }

    /**
     * Remove inactive tokens by their
     * latest signature from RPC
     * @param tokenMap
     */
    async filterLatestSignature(tokenMap: Map<string, Token>) {
        // Get cached recent signatures, so we can skip RPC requests for them.
        let cachedRecentSignatures = new Map<string, number>()
        try {
            cachedRecentSignatures = new Map<string, number>(
                Object.entries(
                    JSON.parse(
                        Provider.readCachedJSON(
                            LegacyTokenProvider._cacheKeyRecentSignatures
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
        const data: object[] = []
        for (const mint of tokenMap.keys()) {
            const cached = cachedRecentSignatures.get(mint)
            if (cached && cached > date) {
                continue
            }

            data.push(RpcRequestSignature(mint))
        }

        // Chunk batches
        let progress = 0
        const chunks = _.chunk(data, this.throttleOpts.batchSignatures)
        for (const dataChunk of chunks) {
            console.log(
                `[LTL] filter by signature ${++progress}/${chunks.length}`
            )

            const response = await axios.post<RpcResponseSignature[]>(
                // 'https://mainnet-beta.solflare.network/',
                this.rpcUrl,
                dataChunk
            )

            for (const mintResponse of response.data) {
                if (
                    !mintResponse.result.length ||
                    mintResponse.result[0].blockTime < date
                ) {
                    tokenMap.delete(mintResponse.id)
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

        Provider.saveCachedJSON(
            LegacyTokenProvider._cacheKeyRecentSignatures,
            JSON.stringify(Object.fromEntries(cachedRecentSignatures))
        )
    }

    /**
     * Remove tokens with few accounts
     * @param tokenMap
     */
    async filterHolders(tokenMap: Map<string, Token>) {
        // Get cached largest tokens, so we can skip RPC requests for them.
        let cachedLargeTokens = new Map<string, number>()
        try {
            cachedLargeTokens = new Map<string, number>(
                Object.entries(
                    JSON.parse(
                        Provider.readCachedJSON(
                            LegacyTokenProvider._cacheKeyLargeAccounts
                        )
                    )
                )
            )
            console.log('[LTL] Use cache for large mints')
        } catch (e) {
            console.log('[LTL] No cache for large mints')
        }

        // Chunk them so we can parallelly send multiple RPC requests
        let progress = 0
        const batches = _.chunk(
            Array.from(tokenMap.keys()),
            this.throttleOpts.batchTokenHolders
        )
        for (const batch of batches) {
            console.log(
                `[LTL] filter by holder ${++progress}/${batches.length}`
            )

            const requests: AxiosPromise[] = []

            for (const mint of batch) {
                if (
                    LARGEST_MINST.includes(mint) ||
                    cachedLargeTokens.has(mint)
                ) {
                    continue
                }

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

                    if (!response.value.data.result) {
                        console.log(
                            `[LTL] Failed RPC holders call for ${mint}`,
                            response.value.data
                        )
                    }

                    const count = response.value.data.result.length
                    if (count < this.minHolders) {
                        tokenMap.delete(mint)
                        continue
                    }

                    if (count >= 1000) {
                        cachedLargeTokens.set(mint, count)
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

        Provider.saveCachedJSON(
            LegacyTokenProvider._cacheKeyLargeAccounts,
            JSON.stringify(Object.fromEntries(cachedLargeTokens))
        )
    }

    public static clearCache() {
        this.removeCachedJSON(this._cacheKeyLargeAccounts)
        this.removeCachedJSON(this._cacheKeyRecentSignatures)
    }
}
