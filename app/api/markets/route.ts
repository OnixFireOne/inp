// app/api/markets/route.ts
// Proxy over CoinGecko /coins/markets. One call returns everything a table row needs:
// icon, price, market cap, 24h change AND the 7d sparkline. Sorted by market cap.
//
// Cache: short TTL (default 45s). Hides the API key. Shared across all users.

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import type { MarketsResponse, MarketRow } from "@/lib/types"

const BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"
const KEY = process.env.COINGECKO_API_KEY || ""
const TTL = Number(process.env.MARKETS_TTL_SECONDS ?? 45)
const PER_PAGE = 100

function getCoinGeckoHeaders() {
  const isPro = process.env.COINGECKO_BASE?.includes('pro-api')
  const headerKey = isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'
  return { [headerKey]: KEY }
}

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids")
  const pageRaw = Number(req.nextUrl.searchParams.get("page") ?? "1")
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1

  // Single-coin lookup: /api/markets?ids=bitcoin,ethereum
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean)
    if (!ids.length) return json({ rows: [] }, 200)

    const cacheKey = `markets:ids:${ids.sort().join(",")}`
    const cached = await kvGet<{ rows: MarketRow[] }>(cacheKey)
    if (cached) return json(cached)

    const url =
      `${BASE}/coins/markets?vs_currency=usd` +
      `&ids=${encodeURIComponent(ids.join(","))}` +
      `&order=market_cap_desc&per_page=${ids.length}` +
      `&sparkline=false&price_change_percentage=24h`

    const res = await fetch(url, { headers: getCoinGeckoHeaders() })
    if (!res.ok) {
      return json({ rows: [] }, 200)
    }

    const raw = (await res.json()) as Array<any>
    const rows: MarketRow[] = raw.map((r) => ({
      id: String(r.id),
      rank: typeof r.market_cap_rank === "number" ? r.market_cap_rank : 0,
      name: String(r.name ?? ""),
      symbol: String(r.symbol ?? "").toUpperCase(),
      image: typeof r.image === "string" ? r.image : "",
      price: Number(r.current_price ?? 0),
      marketCap:
        r.market_cap == null ? null : Number(r.market_cap),
      change24h: Number(r.price_change_percentage_24h ?? 0),
      sparkline: [],
    }))

    const payload = { rows }
    await kvSetEx(cacheKey, TTL, payload)
    return json(payload)
  }

  const cacheKey = `markets:page:${page}`
  const cached = await kvGet<MarketsResponse>(cacheKey)
  if (cached) return json(cached)

  const url =
    `${BASE}/coins/markets?vs_currency=usd` +
    `&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}` +
    `&sparkline=true&price_change_percentage=24h`

  const res = await fetch(url, { headers: getCoinGeckoHeaders() })
  if (!res.ok) {
    return json({ rows: [], page, perPage: PER_PAGE, hasMore: false }, 200)
  }

  const raw = (await res.json()) as Array<any>
  const rows: MarketRow[] = raw.map((r) => ({
    id: String(r.id),
    rank: typeof r.market_cap_rank === "number" ? r.market_cap_rank : 0,
    name: String(r.name ?? ""),
    symbol: String(r.symbol ?? "").toUpperCase(),
    image: typeof r.image === "string" ? r.image : "",
    price: Number(r.current_price ?? 0),
    marketCap:
      r.market_cap == null ? null : Number(r.market_cap),
    change24h: Number(r.price_change_percentage_24h ?? 0),
    sparkline: Array.isArray(r.sparkline_in_7d?.price)
      ? (r.sparkline_in_7d.price as number[])
      : [],
  }))

  const payload: MarketsResponse = {
    rows,
    page,
    perPage: PER_PAGE,
    // CoinGecko returns fewer items on the last page.
    hasMore: rows.length === PER_PAGE,
  }

  await kvSetEx(cacheKey, TTL, payload)
  return json(payload)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${TTL}, stale-while-revalidate=30`,
    },
  })
}
