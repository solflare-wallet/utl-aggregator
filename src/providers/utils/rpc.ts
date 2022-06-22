export function RpcRequestSignature(mint: string) {
    return {
        jsonrpc: '2.0',
        id: mint,
        method: 'getSignaturesForAddress',
        params: [
            `${mint}`,
            {
                limit: 1,
            },
        ],
    }
}

export interface RpcResponseSignature {
    id: string
    jsonrpc: string
    result: {
        blockTime: number
        confirmationStatus: number
    }[]
}

export function RpcRequestAccountInfo(mint: string) {
    return {
        jsonrpc: '2.0',
        id: mint,
        method: 'getAccountInfo',
        params: [
            `${mint}`,
            {
                encoding: 'jsonParsed',
            },
        ],
    }
}

export interface RpcResponseAccountInfo {
    id: string
    error: object | undefined
    jsonrpc: string
    result: {
        value: {
            data: {
                parsed: {
                    info: {
                        decimals: number
                    }
                    type: string // "mint"
                }
                program: string // "spl-token"
            }
        }
    }
}

export function RpcRequestHolders(mint: string) {
    return {
        jsonrpc: '2.0',
        id: mint,
        method: 'getProgramAccounts',
        params: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // TOKEN_PROGRAM_ID
            {
                encoding: 'base64',
                dataSlice: {
                    offset: 0,
                    length: 0,
                },
                filters: [
                    {
                        dataSize: 165,
                    },
                    {
                        memcmp: {
                            offset: 0,
                            bytes: mint,
                        },
                    },
                ],
            },
        ],
    }
}

export interface RpcResponseHolders {
    id: string
    jsonrpc: string
    result: {
        pubKey: string
    }[]
}
