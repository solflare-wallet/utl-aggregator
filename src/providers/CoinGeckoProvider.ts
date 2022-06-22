import axios, { AxiosPromise } from 'axios'
import _ from 'lodash'

import { Provider, Tag, Token } from './provider'
import { RpcRequestAccountInfo, RpcResponseAccountInfo } from './utils/rpc'

interface SimpleCoin {
    id: string
    symbol: string
    name: string
    platforms: {
        solana?: string
    }
}

interface ThrottleOptions {
    throttle: number
    throttleCoinGecko: number
    batchAccountsInfo: number
    batchCoinGecko: number
}

export class CoinGeckoProvider extends Provider {
    private readonly apiUrl = 'https://api.coingecko.com/api/v3'
    private readonly apiProUrl = 'https://pro-api.coingecko.com/api/v3'

    constructor(
        private readonly apiKey: string | null,
        private readonly rpcUrl: string,
        private readonly throttleOpts: ThrottleOptions = {
            throttle: 0, // Add sleep after batch RPC request to avoid rate limits
            throttleCoinGecko: 60 * 1000, // Add sleep after batch HTTP calls for CoinGecko
            batchAccountsInfo: 250, // Batch RPC calls in single RPC request
            batchCoinGecko: 50, // Batch CoinGecko token HTTP call
        }
    ) {
        super()
    }

    async getTokens(): Promise<Map<string, Token>> {
        const tokenMap = new Map<string, Token>()

        const tokens = await axios.get<SimpleCoin[]>(
            this.coinGeckoApiUrl(`/coins/list?include_platform=true`)
        )

        for (let i = 0; i < tokens.data.length; i++) {
            const token = tokens.data[i]
            if (
                token.platforms.solana !== undefined &&
                token.platforms.solana.length
            ) {
                tokenMap.set(token.platforms.solana, {
                    name: token.name,
                    symbol: token.symbol,
                    address: token.platforms.solana,
                    decimals: null,
                    logoURI: null,
                    tags: new Set<Tag>(),
                    verified: true,
                })
            }
        }

        await this.filterByOnChain(tokenMap)
        await this.fetchDetails(tokenMap)
        return tokenMap
    }

    /**
     * Filter by account info
     * check if mint and get decimals
     * @param tokenMap
     */
    private async filterByOnChain(tokenMap: Map<string, Token>) {
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
                `[CG] filter by account info ${++progress}/${chunks.length}`
            )

            const response = await axios.post<RpcResponseAccountInfo[]>(
                this.rpcUrl,
                dataChunk
            )

            for (const mintResponse of response.data) {
                // Remove token if not a mint
                if (
                    mintResponse.error ||
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
     * Fetch details such as logo
     * @param tokenMap
     */
    private async fetchDetails(tokenMap: Map<string, Token>) {
        const batches = _.chunk(
            Array.from(tokenMap.keys()),
            this.throttleOpts.batchCoinGecko
        )

        let progress = 0
        for (const batch of batches) {
            console.log(`[CG] get logo ${++progress}/${batches.length}`)

            const requests: AxiosPromise[] = []
            for (const mint of batch) {
                requests.push(
                    axios.get<ApiCoinContractResponse>(
                        this.coinGeckoApiUrl(`/coins/solana/contract/${mint}`)
                    )
                )
            }

            // Wait for batch of axios request to finish
            const responses = await Promise.allSettled(requests)
            for (const response of responses) {
                if (response.status === 'fulfilled') {
                    // CoinGecko returns mint address in all uppercase
                    // so mint address cannot be taken from response
                    const mintAddress = response.value.config.url
                        ?.split('/contract/')[1]
                        .substring(0, 44)

                    if (!mintAddress) {
                        throw new Error(
                            `Failed to fetch token info: No mint address`
                        )
                    }

                    const token = tokenMap.get(mintAddress)
                    if (token) {
                        token.logoURI = response.value.data.image.large
                        tokenMap.set(mintAddress, token)
                    }
                } else {
                    throw new Error(
                        `Failed to fetch token info: ${response.reason}`
                    )
                }
            }

            if (this.throttleOpts.throttleCoinGecko) {
                await new Promise((f) =>
                    setTimeout(f, this.throttleOpts.throttleCoinGecko)
                )
            }
        }
    }

    private coinGeckoApiUrl(path: string): string {
        if (!this.apiKey) {
            return `${this.apiUrl}${path}`
        }

        return `${this.apiProUrl}${path}${
            path.includes('?') ? '&' : '?'
        }x_cg_pro_api_key=${this.apiKey}`
    }
}

interface ApiCoinContractResponse {
    id: string
    symbol: string
    name: string
    contract_address: string
    image: {
        large: string
    }
}
