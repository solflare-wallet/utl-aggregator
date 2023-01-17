# Unified Token List Aggregator

The Unified Token List Aggregator (`UTL`) module generates Solana token list JSON based on user specified list of `provider` sources.

By changing the provider source list in the aggregator config one can fine tune the output (explained below), and choose which providers are trusted, and filter out tokens (for example exclude Liquidity Pool (`LP`)-tokens which could be consumed from other sources).

Running a script to call this module periodically will ensure that generated UTL is up-to-date.

Generated JSON can be hosted on CDN or imported in DB to be exposed through API.

The UTL generated through the aggregation process should be considered as a common source of truth for verified tokens across wallets and dApps.

## Our Goal

We want to provide every community member a same base source of truth generated by Token List Aggregator - by soing do, we'll provide the community with a base verified token list. Anyone can use this module without any infrastructure or cost.

Everything after that is only building on top of that, so Token List API is extension, and Token List SDK is extension on top of that. Every step is making things more efficient and optimised.

Everyone can choose what they want to use, host and consume depending on their needs and requirements.

## Related repos

- [Token List API](https://github.com/solflare-wallet/utl-api)
- [Token List SDK](https://github.com/solflare-wallet/utl-sdk)
- [Solflare Token List](https://github.com/solflare-wallet/token-list)


## Installation
```shell
npm i @solflare-wallet/utl-aggregator
```

## Usage

Example usage can be found in [Solfare's Token List repo](https://github.com/solflare-wallet/token-list).


Simple usage: 

```ts
import {
  Generator,
  ProviderCoinGecko,
  ProviderLegacyToken,
  ChainId,
  Tag,
} from "@solflare-wallet/utl-aggregator";
import { clusterApiUrl } from '@solana/web3.js'
import { writeFile } from 'fs/promises'

const SECOND = 1000;
const SECONDS = SECOND;
const MINUTE = 60 * SECOND;
const MINUTES = MINUTE;

// Your Solana RPC URL - may be an open provider like
//   clusterApiUrl("mainnet-beta")
// Or your own RPC instance like QuickNode etc.
const SOLANA_RPC_URL = clusterApiUrl("mainnet-beta")

async function main() {
  // Optionally clear the cache for each provider:
  //   ProviderLegacyToken.clearCache(ChainId.MAINNET)
  //   ProviderLegacyToken.clearCache(ChainId.DEVNET)

  const generator = new Generator([
    // Providers are listen in order of preference
    new ProviderCoinGecko(null, SOLANA_RPC_URL, {
      // Add sleep after batch RPC request to avoid rate limits
      throttle: 1 * SECOND,
      // Add sleep after batch HTTP calls for CoinGecko
      throttleCoinGecko: 65 * SECONDS,
      // Batch RPC calls in single RPC request
      batchAccountsInfo: 100,
      // Batch CoinGecko token HTTP call
      batchCoinGecko: 25,
    }),
    new ProviderLegacyToken(
      'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json',
      SOLANA_RPC_URL,
      {
        // Add sleep after batch RPC request to avoid rate limits
        throttle: 1000,
        // Batch RPC calls in single RPC request
        batchSignatures: 100,
        batchAccountsInfo: 100,
        // Batch parallel RPC requests
        batchTokenHolders: 1,
      },
      // Filter out by tags, eg. remove Liquidity Pool (LP) tokens
      [Tag.LP_TOKEN],
      // Make sure ChainId is for RPC endpoint above
      ChainId.MAINNET,
      // Signature date filter, keep tokens with latest signature in last 30 days
      30,
      // Keep tokens with more than 100 holders
      100
    ),
  ])

  const tokenList = await generator.generateTokenList()

  await writeFile('./solana-tokenlist.json', JSON.stringify(tokenList), 'utf8')

  console.log('UTL Completed, the file was saved!')
}

main()

```


## Token List Providers
Providers are listed in an aggregator. If for example mint/token A is in both CoinGecko and Orca list, only one instance/data will be kept for the final token list, and this is determined based on whether CoinGecko or Orca is positioned higher in the list. If Orca is above CoinGecko, mint A from Orca will be kept, and CoinGecko's mint A will be ignored.

_**Built-in provider sources**_ will be the Pruned Legacy Token List (`LTL`) and CoinGecko (`CG`).
CoinGecko has high barrier of entry for tokens, and is generally excellent when it comes to maintaining token list (since it's their job and business to do so).
Legacy token list will be pruned (remove invalid mints, filtering by holders, last activity, LP tokens, scam tokens; this processed was described in Telegram chat) and transformed into the new standardized format.

[To-Do]  _**External Provider sources**_ (Orca, Raydium, Saber, etc..) can host and maintain their own list of verified tokens, that aggregator can use when generating unified token list. 
Each external provider will have to expose endpoint with a list of tokens they view as verified. This list will be in standardize format (which will include if token is LP-token, etc).

[To-Do] Base external provider repo so any project (Orca, Raydium, Saber..) can host and expose their own verified token list with little developer effort. This allows them to serve as trusted providers for other.

### CoinGecko Provider
Uses CoinGecko API to fetch all tokens with valid Solana mint address. 
Token' logoURI is fetched from CoinGecko also, while decimal is fetched from chain.
That is why this provider also requires Solana RPC mainnet endpoint.

**Throttle notes:**

CoinGecko Free API usually has 25-50 calls/min limit, to avoid `HTTP 429 Too Many Requests` use `batchCoinGecko: 25` 
and `throttleCoinGecko: 65 * 1000`

With CoinGecko Pro API Key, you can increase request sizes eg. `batchCoinGecko: 400`

```ts
new ProviderCoinGecko(
  COINGECKO_API_KEY,
  RPC_URL,
  { // ThrottleOptions
    throttle: 1 * SECOND, // Add sleep after batch RPC request to avoid rate limits
    throttleCoinGecko: 65 * SECONDS, // Add sleep after batch HTTP calls for CoinGecko
    batchAccountsInfo: 100, // Batch RPC calls in single RPC request
    batchCoinGecko: 25, // Batch CoinGecko token HTTP call
  }
)

```


### Legacy Token List Provider
This provider uses existing token list and pulls active and relevant tokens from it.

This is done in following steps:
- Filter by chainId and tags 
- Remove by token content (remove already labeled scam and phishing)
- Check if account is a mint (using getAccountInfo)
- Remove by latest signature date
- Remove by holders count

**Caching:**

Since RPC endpoints calls can fail or take long time on larger requests,
this provider caches few result sets to increase speed for subsequent runs.

Latest signatures are cached and tokens with holder count larger than 1000 are cached.
This means that after first run, every other run will be faster.

To clear cache you can use:
```javascript
ProviderLegacyToken.clearCache(ChainId.MAINNET)
ProviderLegacyToken.clearCache(ChainId.DEVNET)
```


**Throttle notes:**

Different RPC endpoints have very different limits, to avoid `HTTP 429 Too Many Requests` try to thinker with `ThrottleOptions`.


```ts
new ProviderLegacyToken(
  CDN_URL,
  RPC_URL, // Make sure RPC Endpoint is for ChainId specified below
  { // ThrottleOptions
    throttle: 1 * SECOND, // Add sleep after batch RPC request to avoid rate limits
    batchSignatures: 100, // Batch RPC calls in single RPC request
    batchAccountsInfo: 100, // Batch RPC calls in single RPC request
    batchTokenHolders: 1, // Batch parallel RPC requests
  },
  [Tag.LP_TOKEN], // Filter out by tags, eg. remove LP tokens
  ChainId.MAINNET, // Keep only chainId 101 tokens 
  30, // Signature date filter, keep tokens with latest signature in last 30 days
  100, // Keep tokens with more than 100 holders 
)

```
