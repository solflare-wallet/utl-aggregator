import fs from 'fs'
import tempDir from 'temp-dir'
import { TokenSet } from 'types'

export abstract class Provider {
    protected static removeCachedJSON(path: string) {
        if (!path.length) {
            throw new Error('Cache path cant be empty')
        }

        try {
            const fullPath = `${tempDir}/${path}.json`
            fs.unlinkSync(fullPath)
        } catch (err) {
            throw new Error(`Failed to remove cache in ${path} path: ${err}`)
        }
    }

    protected static saveCachedJSON(path: string, content: string) {
        if (!path.length) {
            throw new Error('Cache path cant be empty')
        }

        try {
            const fullPath = `${tempDir}/${path}.json`
            fs.writeFileSync(fullPath, content, 'utf8')
        } catch (err) {
            throw new Error(`Failed to save cache in ${path} path: ${err}`)
        }
    }

    protected static readCachedJSON(path: string): string {
        if (!path.length) {
            throw new Error('Cache path cant be empty')
        }

        const fullPath = `${tempDir}/${path}.json`

        if (!fs.existsSync(fullPath)) {
            throw new Error(
                `Failed to read cache in ${path} path: No such file`
            )
        }

        try {
            return fs.readFileSync(fullPath).toString()
        } catch (err) {
            throw new Error(`Failed to read cache in ${path} path: ${err}`)
        }
    }

    abstract getTokens(): Promise<TokenSet>
}
