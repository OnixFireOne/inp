// app/api/markets/route.ts
// Proxy over CoinGecko /coins/markets. One call returns everything a table row needs:
// icon, price, market cap, 24h change AND the 7d sparkline. Sorted by market cap.
//
// On page === 1 we also pull /global in parallel and synthesize the pinned
// "All Crypto" row (id="all") from real global volume / market cap / 24h
// change, with a 7d sparkline reconstructed from the top-100 individual
// sparklines (top-100 ≈ 90%+ of total cap → very close proxy to total market).
//
// Cache: short TTL (default 120s). Hides the API key. Shared across all users.

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import type { MarketsResponse, MarketRow } from "@/lib/types"

const BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"
const KEY = process.env.COINGECKO_API_KEY || ""
// TTL for the chunked /coins/markets cache (markets:page:N, markets:ids:…).
// Shared with lib/asset-meta/markets-warm.ts which writes the same key family.
const TTL = Number(process.env.MARKETS_TTL_SECONDS ?? 120)
// /global is its own endpoint with its own cadence. Cached at the RAW
// response level (`g` / `data` object) — the sparkline is rebuilt from the
// fresh chunked rows on every request, so we don't want to cache the
// synthesized `allRow`.
const GLOBAL_TTL = Number(process.env.GLOBAL_TTL_SECONDS ?? 120)
// CoinGecko permits at most 250 rows per /coins/markets request. Clients keep
// their existing 100-row pagination while the KV cache stores 250-row chunks.
const CLIENT_PER_PAGE = 100
const COINGECKO_PER_PAGE = 250

// Single-flight per cache key. When N concurrent requests miss the same KV
// key (cold cache, stampede after TTL expiry, two-tab page navigation)
// they all await the same in-flight Promise instead of each issuing their
// own CoinGecko request. The slot is cleared in `finally` — including on
// rejection — so a failed upstream doesn't poison subsequent calls.
//
// Scope: module-level, scoped to the Node process. On serverless multi-
// instance deploys the same N requests would still fan out, but that's
// outside this single-process cache stampede and is handled by Upstash's
// eventual-consistency model.
const inFlight = new Map<string, Promise<unknown>>()

/** De-dupe concurrent work on `key`. If a Promise is already running for
 *  `key`, return it; otherwise start `fn`, memoize the Promise, and clear
 *  it in `finally` (so both success and rejection free the slot). */
function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  // Assign to a local first so the closure captures the same reference;
  // otherwise TS complains about `p` being used before assignment inside
  // the async IIFE's `finally`.
  let p!: Promise<T>
  p = (async () => {
    try {
      return await fn()
    } finally {
      // Only delete OUR slot — a later caller may have replaced the entry
      // with its own Promise (shouldn't happen under JS single-threaded
      // semantics, but defensive against future refactors).
      if (inFlight.get(key) === (p as unknown as Promise<unknown>)) {
        inFlight.delete(key)
      }
    }
  })()
  inFlight.set(key, p as unknown as Promise<unknown>)
  return p
}

// Curated list of stable / gold / tokenized-bond symbols that the beeswarm
// (and any "hot" view) hides. Symbols are matched case-insensitively. Symbols
// in the second list are exact (e.g. USDC); symbols with a trailing "USD" /
// "GOLD" suffix are matched by prefix. Source-of-truth = the same hard-coded
// stable set used by the prototype in plan/inp_hot_beeswarm.html.
const STABLE_SYMBOL_EXACT = new Set<string>([
  "USDT","USDC","USDS","DAI","USDE","USD1","USDC","USDD","USDY","USD0",
  "USDF","FDUSD","PYUSD","TUSD","USDP","USDM","GHO","GUSD","SUSD","USDX",
  "USAT","USYC","AUSD","USDF","USDG","USTB","U","BFUSD","CRVUSD","USDtb",
  "USTBL","USD0","USX","SATUSD","USDM","EURC","EUTBL","RUSD","PAXG","XAUT",
  "USTB","OUSG","JTRSY","JAAA","YLDS","BCAP","USTBL","SSTN1","SSTN3",
  "ONYC","REUSD","USDM","A7A5","KAG","KAU","BUIDL","USTB","USDB","FRAX",
  "APYUSD","APXUSD","USDai","USDa","USAT","USD1","USDA","USDAI","USDF",
  "USDM","USTB","USDB","USTBL","USTBL","USDC","USDD","USDS","USDX","USDE",
  "USDF","USD0","USTB","BUIDL","SSTN1","SSTN3","JTRSY","JAAA","EUTBL",
  "USTBL","USD0","USX","APYUSD","APXUSD","USTB","USDM","U","USDai",
])

// Heuristic symbol prefixes / suffixes for tokenized cash equivalents.
const STABLE_SYMBOL_PATTERNS: RegExp[] = [
  /^USD[A-Z0-9]?$/i,    // USDT, USDC, USDD, USDE, USDT, USD1, ...
  /USD$/i,              // anything ending in USD
  /USDC?$/i,            // anything ending in USDC / USD
]

function isStableSymbol(symbol: string): boolean {
  if (!symbol) return false
  const up = symbol.toUpperCase()
  if (STABLE_SYMBOL_EXACT.has(up)) return true
  return STABLE_SYMBOL_PATTERNS.some((re) => re.test(up))
}

// Map a raw CoinGecko `/coins/markets` payload to our `MarketRow` shape.
// Shared between the single-coin lookup and the chunked full-list path so
// stable classification and sparkline normalization stay consistent.
function mapCoinGeckoRow(r: any): MarketRow {
  return {
    id: String(r.id),
    rank: typeof r.market_cap_rank === "number" ? r.market_cap_rank : 0,
    name: String(r.name ?? ""),
    symbol: String(r.symbol ?? "").toUpperCase(),
    image: typeof r.image === "string" ? r.image : "",
    price: Number(r.current_price ?? 0),
    marketCap: r.market_cap == null ? null : Number(r.market_cap),
    change24h: Number(r.price_change_percentage_24h ?? 0),
    change30d: r.price_change_percentage_30d_in_currency == null
      ? null : Number(r.price_change_percentage_30d_in_currency),
    change1y: r.price_change_percentage_1y_in_currency == null
      ? null : Number(r.price_change_percentage_1y_in_currency),
    sparkline: Array.isArray(r.sparkline_in_7d?.price)
      ? (r.sparkline_in_7d.price as number[])
      : [],
    stable: isStableSymbol(String(r.symbol ?? "")),
  }
}

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
    const payload = await singleFlight(cacheKey, async () => {
      const cached = await kvGet<{ rows: MarketRow[] }>(cacheKey)
      if (cached) return cached

      const url =
        `${BASE}/coins/markets?vs_currency=usd` +
        `&ids=${encodeURIComponent(ids.join(","))}` +
        `&order=market_cap_desc&per_page=${ids.length}` +
        `&sparkline=false&price_change_percentage=24h,30d,1y`

      const res = await fetch(url, { headers: getCoinGeckoHeaders() })
      if (!res.ok) {
        return { rows: [] as MarketRow[] }
      }

      const raw = (await res.json()) as Array<any>
      const rows: MarketRow[] = raw.map((r) => ({ ...mapCoinGeckoRow(r), sparkline: [] }))

      const fresh = { rows }
      await kvSetEx(cacheKey, TTL, fresh)
      return fresh
    })
    return json(payload)
  }

  // Return one 250-row chunk of the global market-cap ranking, hitting
  // CoinGecko on a miss and caching the result. Returning `null` signals a
  // hard failure (non-OK response) so the caller can short-circuit cleanly.
  // Wrapped in singleFlight on the same KV key so N concurrent misses
  // collapse into one upstream call.
  async function getChunk(chunk: number): Promise<MarketRow[] | null> {
    const cacheKey = `markets:page:${chunk}`
    const rows = await singleFlight(cacheKey, async () => {
      const cached = await kvGet<MarketRow[]>(cacheKey)
      if (cached) return cached
      const url =
        `${BASE}/coins/markets?vs_currency=usd` +
        `&order=market_cap_desc&per_page=${COINGECKO_PER_PAGE}&page=${chunk}` +
        `&sparkline=true&price_change_percentage=24h,30d,1y`
      const res = await fetch(url, { headers: getCoinGeckoHeaders() })
      if (!res.ok) return null as MarketRow[] | null
      const raw = (await res.json()) as Array<any>
      const mapped = raw.map(mapCoinGeckoRow)
      await kvSetEx(cacheKey, TTL, mapped)
      return mapped
    })
    return rows
  }

  // A client page can straddle a chunk boundary (e.g. page 3 covers ranks
  // 201–300, while chunks are 1–250 / 251–500). Stitch together every chunk
  // the requested [start, end) window overlaps.
  const start = (page - 1) * CLIENT_PER_PAGE
  const end = start + CLIENT_PER_PAGE
  const firstChunk = Math.floor(start / COINGECKO_PER_PAGE) + 1
  const lastChunk = Math.floor((end - 1) / COINGECKO_PER_PAGE) + 1

  const rows: MarketRow[] = []
  let firstChunkRows: MarketRow[] = []
  let lastChunkRows: MarketRow[] = []
  for (let c = firstChunk; c <= lastChunk; c++) {
    const chunkRows = await getChunk(c)
    if (!chunkRows) break // partial result is better than an empty payload
    if (c === firstChunk) firstChunkRows = chunkRows
    lastChunkRows = chunkRows
    const chunkStart = (c - 1) * COINGECKO_PER_PAGE
    rows.push(
      ...chunkRows.slice(
        Math.max(0, start - chunkStart),
        Math.max(0, end - chunkStart),
      ),
    )
  }

  // On client page 1 only, prepend the synthetic aggregate row. The complete
  // first external chunk is intentionally supplied so its sparkline uses 250 coins.
  if (page === 1) {
    const allRow = await buildAllRow(firstChunkRows)
    if (allRow) rows.unshift(allRow)
  }

  // hasMore = either the current chunk holds rows past the requested window,
  // or the last chunk we touched looks full (suggesting another chunk exists).
  // When the very first chunk failed we have no usable rows — report no further
  // pages rather than guessing based on an empty `lastChunkRows`.
  const lastChunkGlobalEnd =
    lastChunkRows.length > 0
      ? (lastChunk - 1) * COINGECKO_PER_PAGE + lastChunkRows.length
      : 0
  const hasMore =
    rows.length > 0 &&
    (lastChunkGlobalEnd > end || lastChunkRows.length === COINGECKO_PER_PAGE)

  return json({
    rows,
    page,
    perPage: CLIENT_PER_PAGE,
    hasMore,
  })
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
  // /global is the single most-called endpoint on page === 1 — without a
  // cache every refresh of /api/markets?page=1 hits CoinGecko twice. Cache
  // the raw `data` payload; the synthetic row (incl. the sparkline, which
  // is rebuilt from the freshly-loaded chunked rows) is NOT cached.
  // Single-flighted on the same KV key so N concurrent /api/markets?page=1
  // hits (SSR + client RQ + beeswarm paged loader) share one /global call.
  const GLOBAL_KEY = "coingecko:global:usd"
  const g = (await singleFlight(GLOBAL_KEY, async () => {
    const cached = await kvGet<any>(GLOBAL_KEY)
    if (cached) return cached
    try {
      const url = `${BASE}/global`
      const res = await fetch(url, { headers: getCoinGeckoHeaders() })
      if (!res.ok) return null as any
      const raw = (await res.json()) as any
      const data = raw?.data ?? null
      // Only cache successful + well-formed payloads; failures fall back
      // to `return null` below and stay uncached so the next request
      // can try again immediately. The singleFlight slot is still cleared
      // in `finally` either way, so an upstream outage doesn't poison it.
      if (data && data.total_market_cap && data.total_volume) {
        await kvSetEx(GLOBAL_KEY, GLOBAL_TTL, data)
      }
      return data
    } catch {
      return null as any
    }
  })) as any
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
