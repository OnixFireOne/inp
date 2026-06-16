// app/api/links/route.ts
// Drawer data source. CoinGecko drives the table; this route joins curated
// links from Supabase by coingecko_id on click (with hover-prefetch).
//
//   GET /api/links?cg=<coingeckoId>
//   -> { asset: { id, name, ticker, icon, tv_symbol } | null, links: Link[] }

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"
import type { Asset, Link } from "@/types/asset"

const TTL = Number(process.env.LINKS_TTL_SECONDS ?? 60)

export async function GET(req: NextRequest) {
  const cg = (req.nextUrl.searchParams.get("cg") ?? "").trim()
  if (!cg) return json({ asset: null, links: [] })

  const cacheKey = `links:${cg}`
  const cached = await kvGet<{ asset: Asset | null; links: Link[] }>(cacheKey)
  if (cached) return json(cached)

  const supabase = await supabaseServer()

  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("id, name, ticker, icon, coingecko_id, tv_symbol")
    .eq("coingecko_id", cg)
    .maybeSingle()

  if (assetErr) {
    return json({ asset: null, links: [] })
  }
  if (!asset) {
    const empty = { asset: null, links: [] as Link[] }
    await kvSetEx(cacheKey, TTL, empty)
    return json(empty)
  }

  const { data: links, error: linksErr } = await supabase
    .from("links")
    .select("id, asset_id, name, description, href, tier, category, health")
    .eq("asset_id", asset.id)
    .order("tier", { ascending: true })
    .order("is_top", { ascending: false, nullsFirst: false })
    .order("manual_rank", { ascending: true, nullsFirst: false })
    .order("ai_score", { ascending: false, nullsFirst: false })

  if (linksErr) {
    return json({ asset, links: [] })
  }

  const payload = { asset, links: (links ?? []) as Link[] }
  await kvSetEx(cacheKey, TTL, payload)
  return json(payload)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${TTL}, stale-while-revalidate=120`,
    },
  })
}
