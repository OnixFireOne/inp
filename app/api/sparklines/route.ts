import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import type { SparklinesResponse } from "@/lib/types"

const BASE = process.env.COINGECKO_BASE || "https://api.coingecko.com/api/v3"
const KEY = process.env.COINGECKO_API_KEY || ""
const TTL = Number(process.env.SPARK_TTL_SECONDS ?? 300)

function getCoinGeckoHeaders() {
  const isPro = process.env.COINGECKO_BASE?.includes('pro-api')
  const headerKey = isPro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key'
  return { [headerKey]: KEY }
}

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
  const MAX_IDS = 50
  const limitedIds = [...new Set(ids)].slice(0, MAX_IDS)
  const window = req.nextUrl.searchParams.get("window") ?? "24h"
  const days = window === '7d' ? 7 : 1
  if (limitedIds.length === 0) return Response.json({ series: {} })

  const series: Record<string, number[]> = {}
  const missing: string[] = []
  for (const id of limitedIds) {
    const hit = await kvGet<number[]>(`spark:${id}:${window}`)
    if (hit) series[id] = hit; else missing.push(id)
  }

  await Promise.all(missing.map(async id => {
    const url = `${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${days}`
    const r = await fetch(url, { headers: getCoinGeckoHeaders() })
    if (!r.ok) { series[id] = []; return }
    const data = await r.json() as { prices: [number, number][] }
    const pts = downsample(data.prices.map(p => p[1]), 24)
    series[id] = pts
    await kvSetEx(`spark:${id}:${window}`, TTL, pts)
  }))

  return new Response(JSON.stringify({ series } as SparklinesResponse), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${TTL}, stale-while-revalidate=120`,
    },
  })
}

function downsample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)])
}
