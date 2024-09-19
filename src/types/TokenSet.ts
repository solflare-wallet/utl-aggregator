import { Token } from './index'

export class TokenSet {
    constructor(
        private source: string,
        private map = new Map<string, Token>()
    ) {}

    protected static tokenKey(mint: string, chainId: number) {
        return `${mint}:${chainId}`
    }

    protected static keyToMint(key: string) {
        return key.split(':')[0]
    }

    sourceName(): string {
        return this.source
    }

    mints(): string[] {
        return Array.from(this.map.keys()).map((key) => TokenSet.keyToMint(key))
    }

    tokens(): Token[] {
        return Array.from(this.map.values())
    }

    set(token: Token): this {
        this.map.set(TokenSet.tokenKey(token.address, token.chainId), token)
        return this
    }

    hasByMint(mint: string, chainId: number): boolean {
        return this.map.has(TokenSet.tokenKey(mint, chainId))
    }

    hasByToken(token: Token): boolean {
        return this.map.has(TokenSet.tokenKey(token.address, token.chainId))
    }

    getByMint(mint: string, chainId: number): Token | undefined {
        return this.map.get(TokenSet.tokenKey(mint, chainId))
    }

    getByToken(token: Token): Token | undefined {
        return this.map.get(TokenSet.tokenKey(token.address, token.chainId))
    }

    deleteByMint(mint: string, chainId: number): boolean {
        return this.map.delete(TokenSet.tokenKey(mint, chainId))
    }

    deleteByToken(token: Token): boolean {
        return this.map.delete(TokenSet.tokenKey(token.address, token.chainId))
    }
}
