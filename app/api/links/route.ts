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
  asset_id: string | null
}

const TTL = Number(process.env.LINKS_TTL_SECONDS ?? 60)

export async function GET(req: NextRequest) {
  const cg = (req.nextUrl.searchParams.get("cg") ?? "").trim()
  if (!cg) return json({ asset: null, links: [], categories: [] })

  // Compose the cache key with the categories-table version, so a bump of
  // the version (via /api/admin/invalidate-link-caches) atomically retires
  // every previously-cached payload after a category metadata change.
  const version = await kvGet<number>("links:cache_version")
  const v = typeof version === "number" ? version : 0
  const cacheKey = `links:v${v}:${cg}`
  const cached = await kvGet<{ asset: Asset | null; links: Link[]; categories: CategoryMeta[] }>(cacheKey)
  if (cached) return json(cached)

  const supabase = await supabaseServer()

  // Asset first: we need its id to scope the categories query
  // (global categories ∪ categories scoped to this asset only).
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("id, name, ticker, icon, coingecko_id, tv_symbol, category_orders")
    .eq("coingecko_id", cg)
    .maybeSingle()

  if (assetErr) {
    return json({ asset: null, links: [], categories: [] })
  }
  if (!asset) {
    const empty = { asset: null, links: [] as Link[], categories: [] as CategoryMeta[] }
    await kvSetEx(cacheKey, TTL, empty)
    return json(empty)
  }

  // Categories: global (asset_id is null) ∪ scoped to this asset only.
  // Dedupe by key — if a per-asset row exists for the same key as a global
  // (shouldn't, because keys are globally unique, but defend anyway), the
  // per-asset row wins so it can override label/icon for this coin.
  const { data: rawCategories, error: catErr } = await supabase
    .from("link_categories")
    .select("key, label, icon, sort, asset_id")
    .or(`asset_id.is.null,asset_id.eq.${asset.id}`)
    .order("sort", { ascending: true })

  if (catErr) {
    return json({ asset: null, links: [], categories: [] })
  }

  const categories = dedupeCategoriesByKey((rawCategories ?? []) as CategoryMeta[])

  const { data: links, error: linksErr } = await supabase
    .from("links")
    .select("id, asset_id, name, description, href, tier, category, health, is_top, manual_rank, ai_score")
    .eq("asset_id", asset.id)
    .order("tier", { ascending: true })
    .order("is_top", { ascending: false, nullsFirst: false })
    .order("manual_rank", { ascending: true, nullsFirst: false })
    .order("ai_score", { ascending: false, nullsFirst: false })

  if (linksErr) {
    return json({ asset, links: [], categories })
  }

  const payload = {
    asset,
    links: (links ?? []) as Link[],
    // Per-asset category sort override. `category_orders` is a jsonb map of
    // { categoryKey: sortIndex }. Missing keys fall back to the row's sort.
    // This is the unified ordering for global AND per-coin categories — so a
    // per-coin category can sit between globals for this asset.
    categories: applyCategoryOrder(categories, (asset as { category_orders?: Record<string, number> | null } | null)?.category_orders ?? null),
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

// Dedupe categories by `key`. Per-asset rows (asset_id != null) win over
// globals (asset_id == null) for the same key, so a per-asset category can
// override label/icon for one coin without losing it elsewhere. Caller is
// responsible for sorting.
function dedupeCategoriesByKey(rows: CategoryMeta[]): CategoryMeta[] {
  const byKey = new Map<string, CategoryMeta>()
  for (const r of rows) {
    const prev = byKey.get(r.key)
    if (!prev) {
      byKey.set(r.key, r)
      continue
    }
    // Per-asset row wins.
    const prevScoped = prev.asset_id != null
    const nextScoped = r.asset_id != null
    if (!prevScoped && nextScoped) {
      byKey.set(r.key, r)
    }
    // else: keep prev
  }
  return Array.from(byKey.values())
}
