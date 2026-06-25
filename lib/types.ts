export type Quote = {
  price: number
  change24h: number
  marketCap: number | null
  ts: number
}

export type PricesResponse = {
  quotes: Record<string, Quote>
}

export type SparklinesResponse = {
  series: Record<string, number[]>
}

/** A single row in the markets table (CoinGecko-driven). */
export type MarketRow = {
  id: string
  /** `null` → table renders a Pin icon (e.g. the synthetic "all" row). */
  rank: number | null
  name: string
  symbol: string
  image: string
  /** `null` → PriceCell renders "—". */
  price: number | null
  marketCap: number | null
  change24h: number
  change30d?: number | null
  change1y?: number | null
  sparkline: number[]
  /** Stablecoin / gold / tokenized-bond flag — used to filter the beeswarm. */
  stable?: boolean
}

export type MarketsResponse = {
  rows: MarketRow[]
  page: number
  perPage: number
  hasMore: boolean
}

export type SparkWindow = "7d" | "24h"
