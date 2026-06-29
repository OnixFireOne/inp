// lib/asset-meta/markets-warm.ts
// On-demand warm of one coin's market row. Enables cold deep-linked coins
// absent from every warmed `markets:page:*` cache. Writes the same
// `markets:ids:{id}` key the route + allowlist read, so a successful warm opens
// the allowlist gate and supplies the ticker for {symbol} patterns. One network
// call; caller negative-caches misses.

import { kvGet, kvSetEx } from "../kv"
import type { MarketRow } from "../types"

const BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"
const KEY = process.env.COINGECKO_API_KEY || ""
const TTL = Number(process.env.MARKETS_TTL_SECONDS ?? 45)

function cgHeaders(): Record<string, string> {
  if (!KEY) return {}
  const isPro = BASE.includes("pro-api")
  return { [isPro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: KEY }
}

export async function warmMarketRow(id: string): Promise<MarketRow | null> {
  if (!id) return null
  const cacheKey = `markets:ids:${id}`

  const cached = await kvGet<{ rows: MarketRow[] }>(cacheKey)
  if (cached) return cached.rows.find((r) => r.id === id) ?? null

  const url =
    `${BASE}/coins/markets?vs_currency=usd` +
    `&ids=${encodeURIComponent(id)}` +
    `&order=market_cap_desc&per_page=1` +
    `&sparkline=false&price_change_percentage=24h,30d,1y`

  let res: Response
  try {
    res = await fetch(url, { headers: cgHeaders(), cache: "no-store" })
  } catch {
    return null
  }
  if (!res.ok) return null

  let raw: Array<Record<string, unknown>>
  try {
    raw = (await res.json()) as Array<Record<string, unknown>>
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length === 0) return null

  const rows: MarketRow[] = raw.map((r: any) => ({
    id: String(r.id),
    rank: typeof r.market_cap_rank === "number" ? r.market_cap_rank : 0,
    name: String(r.name ?? ""),
    symbol: String(r.symbol ?? "").toUpperCase(),
    image: typeof r.image === "string" ? r.image : "",
    price: Number(r.current_price ?? 0),
    marketCap: r.market_cap == null ? null : Number(r.market_cap),
    change24h: Number(r.price_change_percentage_24h ?? 0),
    change30d:
      r.price_change_percentage_30d_in_currency == null
        ? null
        : Number(r.price_change_percentage_30d_in_currency),
    change1y:
      r.price_change_percentage_1y_in_currency == null
        ? null
        : Number(r.price_change_percentage_1y_in_currency),
    sparkline: [],
    stable: false,
  }))

  await kvSetEx(cacheKey, TTL, { rows })
  return rows.find((r) => r.id === id) ?? null
}