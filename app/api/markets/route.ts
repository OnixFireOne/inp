// app/api/markets/route.ts
// Proxy over CoinGecko /coins/markets. One call returns everything a table row needs:
// icon, price, market cap, 24h change AND the 7d sparkline. Sorted by market cap.
//
// On page === 1 we also pull /global in parallel and synthesize the pinned
// "All Crypto" row (id="all") from real global volume / market cap / 24h
// change, with a 7d sparkline reconstructed from the top-100 individual
// sparklines (top-100 ≈ 90%+ of total cap → very close proxy to total market).
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
      `&sparkline=false&price_change_percentage=24h,30d,1y`

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
      change30d: r.price_change_percentage_30d_in_currency == null
        ? null : Number(r.price_change_percentage_30d_in_currency),
      change1y: r.price_change_percentage_1y_in_currency == null
        ? null : Number(r.price_change_percentage_1y_in_currency),
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
    `&sparkline=true&price_change_percentage=24h,30d,1y`

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
    change30d: r.price_change_percentage_30d_in_currency == null
      ? null : Number(r.price_change_percentage_30d_in_currency),
    change1y: r.price_change_percentage_1y_in_currency == null
      ? null : Number(r.price_change_percentage_1y_in_currency),
    sparkline: Array.isArray(r.sparkline_in_7d?.price)
      ? (r.sparkline_in_7d.price as number[])
      : [],
  }))

  // On page 1 only: also pull /global and prepend a synthetic "All Crypto" row
  // with real totals (market cap, 24h volume, 24h change) and a reconstructed
  // 7d total-market-cap sparkline.
  if (page === 1) {
    const allRow = await buildAllRow(rows)
    if (allRow) {
      rows.unshift(allRow)
    }
  }

  const payload: MarketsResponse = {
    rows,
    page,
    perPage: PER_PAGE,
    // CoinGecko returns fewer items on the last page.
    hasMore: rows.length - (page === 1 ? 1 : 0) === PER_PAGE,
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

// -------------------------------------------------------------
// "All Crypto" synthetic row
// -------------------------------------------------------------
//
// Pulls /global from CoinGecko with the same headers as markets and builds a
// pinned first row:
//   • price       → total_volume.usd
//   • marketCap   → total_market_cap.usd
//   • change24h   → market_cap_change_percentage_24h_usd
//   • sparkline   → reconstructed total-market-cap series from top-100
//
// /global does NOT expose history (the chart endpoint is paid), so we
// synthesize the 7d shape from per-coin 7d sparklines by re-scaling each
// coin's market cap to its price ratio at point t. Top-100 covers ≈90%+ of
// total cap → very close visual proxy for the whole market.
async function buildAllRow(rows: MarketRow[]): Promise<MarketRow | null> {
  let g: any = null
  try {
    const url = `${BASE}/global`
    const res = await fetch(url, { headers: getCoinGeckoHeaders() })
    if (res.ok) {
      const raw = (await res.json()) as any
      g = raw?.data ?? null
    }
  } catch {
    g = null
  }
  if (!g || !g.total_market_cap || !g.total_volume) return null

  const totalMc = Number(g.total_market_cap.usd)
  const totalVol = Number(g.total_volume.usd)
  const change24h = Number(g.market_cap_change_percentage_24h_usd ?? 0)
  if (!Number.isFinite(totalMc) || !Number.isFinite(totalVol)) return null

  return {
    id: "all",
    rank: null,                       // table renders Pin
    name: "All Crypto",
    symbol: "ALL",
    image: "/icons/all.svg",
    price: totalVol,                  // "price" column → 24h volume
    marketCap: totalMc,
    change24h: Number.isFinite(change24h) ? change24h : 0,
    change30d: null,
    change1y: null,
    sparkline: buildGlobalSparkline(rows),
  }
}

// Reconstruct a 7d total-market-cap series from per-coin 7d price sparklines.
//
// Per-coin:  marketCap_i(t) ≈ marketCap_i_now * (price_i(t) / price_i(now))
// Total:     Σ_i marketCap_i(t)
//
// Assumes supply is roughly constant over 7 days (true for the vast majority
// of large caps). The result is in absolute USD; SparklineCell normalizes
// against its own min/max so the absolute scale doesn't matter — only the
// shape, which matches the real total-market-cap trend very closely.
function buildGlobalSparkline(rows: MarketRow[]): number[] {
  const series = rows
    .map((r) => ({ mc: r.marketCap ?? 0, s: r.sparkline ?? [] }))
    .filter((x) => x.mc > 0 && x.s.length > 1)

  if (series.length === 0) return []

  // Align lengths: take the shortest sparkline as the common window.
  const len = Math.min(...series.map((x) => x.s.length))
  if (len <= 1) return []

  const out = new Array<number>(len).fill(0)
  for (const { mc, s } of series) {
    const last = s[s.length - 1]
    if (!last || last <= 0) continue
    const offset = s.length - len
    for (let t = 0; t < len; t++) {
      out[t] += mc * (s[offset + t] / last)
    }
  }
  return out
}
