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

interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
}

const TTL = Number(process.env.LINKS_TTL_SECONDS ?? 60)

export async function GET(req: NextRequest) {
  const cg = (req.nextUrl.searchParams.get("cg") ?? "").trim()
  if (!cg) return json({ asset: null, links: [], categories: [] })

  const cacheKey = `links:${cg}`
  const cached = await kvGet<{ asset: Asset | null; links: Link[]; categories: CategoryMeta[] }>(cacheKey)
  if (cached) return json(cached)

  const supabase = await supabaseServer()

  const [{ data: asset, error: assetErr }, { data: categories, error: catErr }] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, ticker, icon, coingecko_id, tv_symbol, category_orders")
      .eq("coingecko_id", cg)
      .maybeSingle(),
    supabase
      .from("link_categories")
      .select("key, label, icon, sort")
      .order("sort", { ascending: true }),
  ])

  if (assetErr) {
    return json({ asset: null, links: [], categories: [] })
  }
  if (!asset) {
    const empty = { asset: null, links: [] as Link[], categories: [] as CategoryMeta[] }
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
    return json({ asset, links: [], categories: categories ?? [] })
  }

  const payload = {
    asset,
    links: (links ?? []) as Link[],
    // Per-asset category sort override. `category_orders` is a jsonb map of
    // { categoryKey: sortIndex }. Missing keys fall back to the table's sort.
    categories: applyCategoryOrder((categories ?? []) as CategoryMeta[], (asset as { category_orders?: Record<string, number> | null } | null)?.category_orders ?? null),
  }
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

// Merge per-asset sort overrides on top of the default link_categories.sort.
// Override wins when present; otherwise the row's default sort is kept. Stable
// for any category not mentioned in the override.
function applyCategoryOrder(
  categories: CategoryMeta[],
  overrides: Record<string, number> | null,
): CategoryMeta[] {
  if (!overrides || typeof overrides !== "object") return categories
  const out = categories.map((c) => {
    const v = overrides[c.key]
    return typeof v === "number" && Number.isFinite(v) ? { ...c, sort: v } : c
  })
  out.sort((a, b) => a.sort - b.sort)
  return out
}
