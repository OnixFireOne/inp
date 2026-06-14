export type Quote = {
  price: number
  change24h: number
  ts: number
}

export type PricesResponse = {
  quotes: Record<string, Quote>
}

export type SparklinesResponse = {
  series: Record<string, number[]>
}
