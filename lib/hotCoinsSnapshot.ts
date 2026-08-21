// Shape of `window.__HOT_COINS_SNAPSHOT__`, written by HotCoinsBeeswarm right
// after it re-renders its node array. Copy this file verbatim into the
// morning-post repo — `version` lets that script fail loudly on a contract
// change instead of silently misreading fields.

export const HOT_COINS_SNAPSHOT_VERSION = 1 as const

export type SwarmCoin = {
  id: string // coingecko id
  ticker: string // UPPERCASE, as drawn on the chart
  change24h: number // percent, not a fraction
  price: number
  marketCap: number | null
}

export type HotCoinsSnapshot = {
  version: typeof HOT_COINS_SNAPSHOT_VERSION
  ts: string // ISO, moment of render
  btc: { price: number; change24h: number } | null
  mainSwarm: SwarmCoin[] // coins currently inside the swarm viewport
  edgePins: SwarmCoin[] // coins pinned to the edge (off-screen at current pan/zoom)
}

declare global {
  interface Window {
    __HOT_COINS_SNAPSHOT__?: HotCoinsSnapshot
  }
}
