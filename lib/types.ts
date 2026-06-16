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
  rank: number
  name: string
  symbol: string
  image: string
  price: number
  marketCap: number | null
  change24h: number
  sparkline: number[]
}

export type MarketsResponse = {
  rows: MarketRow[]
  page: number
  perPage: number
  hasMore: boolean
}

export type SparkWindow = "7d" | "24h"
