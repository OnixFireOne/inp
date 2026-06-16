import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import type { PricesResponse } from "@/lib/types"

const BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"
const KEY = process.env.COINGECKO_API_KEY || ""
const TTL = Number(process.env.PRICE_TTL_SECONDS ?? 20)

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) return Response.json({ quotes: {} })

  const cacheKey = `prices:${[...ids].sort().join(",")}`
  const cached = await kvGet<PricesResponse>(cacheKey)
  if (cached) return json(cached)

  const url = `${BASE}/coins/markets?vs_currency=usd`
    + `&ids=${encodeURIComponent(ids.join(","))}`
    + `&price_change_percentage=24h&per_page=250&page=1`

  const res = await fetch(url, {
    headers: { "x-cg-demo-api-key": KEY },
  })
  if (!res.ok) return json({ quotes: {} }, 200)

  const rows = await res.json() as Array<any>
  const now = Date.now()
  const quotes: Record<string, any> = {}
  for (const r of rows) {
    quotes[r.id] = {
      price: r.current_price,
      change24h: r.price_change_percentage_24h ?? 0,
      marketCap: r.market_cap ?? null,
      ts: now,
    }
  }
  const payload: PricesResponse = { quotes }
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
