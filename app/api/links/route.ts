// app/api/links/route.ts
// Drawer data source. CoinGecko drives the table; this route joins curated
// links from Supabase by coingecko_id on click (with hover-prefetch). If a
// coin has no curated links yet, it returns virtual links generated from
// link_templates + cached provider metadata.
//
//   GET /api/links?cg=<coingeckoId>
//   -> { asset, links, categories, generated, status }

import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"
import { supabaseServer } from "@/lib/supabase/server"
import type { Asset, Link } from "@/types/asset"
import { getLinkCacheKey } from "@/lib/links/cache-key"
import { ensureAssetMeta } from "@/lib/asset-meta/ensure"
import { getMarketRowFromCache } from "@/lib/asset-meta/markets-allowlist"
import { maybeBackfillAssetFromMarket } from "@/lib/links/backfill-asset"
import { buildAssetVars } from "@/lib/links/build-asset-vars"
import { getActiveTemplates } from "@/lib/links/templates-cache"
import { composeLinksPayload } from "@/lib/links/compose"

interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
  asset_id: string | null
}

type AssetRow = Asset & {
  status?: "described" | "template" | null
  category_orders?: Record<string, number> | null
}

type LinksPayload = {
  asset: Asset | null
  links: Link[]
  categories: CategoryMeta[]
  generated: boolean
  status: "described" | "template" | "undescribed"
}

const TTL = Number(process.env.LINKS_TTL_SECONDS ?? 60)
const ENSURE_INLINE_TIMEOUT_MS = Number(
  process.env.ENSURE_INLINE_TIMEOUT_MS ?? 5000,
)

const ASSET_SELECT =
  "id, name, ticker, icon, coingecko_id, tv_symbol, category_orders, status"

export async function GET(req: NextRequest) {
  const cg = (req.nextUrl.searchParams.get("cg") ?? "").trim()
  if (!cg) return json(emptyPayload())

  const cacheKey = await getLinkCacheKey(cg)
  const cached = await kvGet<LinksPayload>(cacheKey)
  if (cached) return json(cached)

  const supabase = await supabaseServer()
  // Asset first: we need its id to load curated links and scoped categories.
  let asset = await loadAsset(supabase, cg)

  let curated = asset ? await loadCuratedLinks(supabase, asset.id) : ([] as Link[])

  // Cold/template coin without curated links: do the snapshot warm inline so
  // the first response can include provider links and {symbol} patterns.
  // Described/curated coins never wait here.
  const needsSnapshot =
    (!asset || asset.status === "template") && (curated?.length ?? 0) === 0
  if (needsSnapshot) {
    await ensureAssetMetaInline(cg, ENSURE_INLINE_TIMEOUT_MS)
    // Re-read: ensureAssetMeta may have created the stub, warmed markets:ids,
    // and inserted asset_meta.
    asset = await loadAsset(supabase, cg)
    curated = asset ? await loadCuratedLinks(supabase, asset.id) : ([] as Link[])
  }

  // Read the warmed market row only after inline ensure. This supplies ticker
  // for {symbol} templates on cold deep links.
  const marketRow = await getMarketRowFromCache(cg)

  // Enrich minimal stubs without blocking render and without overwriting data.
  maybeBackfillAssetFromMarket(asset, marketRow)

  const assetId = asset?.id ?? cg

  const categories = await loadCategories(supabase, assetId, !!asset)
  const orderedCategories = applyCategoryOrder(
    dedupeCategoriesByKey(categories),
    asset?.category_orders ?? null,
  )

  const [{ data: meta }, templates] = await Promise.all([
    supabase
      .from("asset_meta")
      .select("data")
      .eq("asset_id", asset?.id ?? cg)
      .eq("provider", "coingecko")
      .maybeSingle(),
    getActiveTemplates(),
  ])

  const assetVars = buildAssetVars(cg, asset, marketRow)
  const payload = composeLinksPayload<CategoryMeta>({
    asset,
    assetId,
    curated,
    categories: orderedCategories,
    templates,
    assetVars,
    metaByProvider: meta?.data ? { coingecko: meta.data } : {},
  })

  await kvSetEx(cacheKey, TTL, payload)
  return json(payload)
}

async function loadCategories(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  assetId: string,
  hasAsset: boolean,
): Promise<CategoryMeta[]> {
  const query = supabase
    .from("link_categories")
    .select("key, label, icon, sort, asset_id")
    .order("sort", { ascending: true })

  const { data, error } = hasAsset
    ? await query.or(`asset_id.is.null,asset_id.eq.${assetId}`)
    : await query.is("asset_id", null)

  if (error) return []
  return (data ?? []) as CategoryMeta[]
}

async function loadAsset(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  cg: string,
): Promise<AssetRow | null> {
  const { data, error } = await supabase
    .from("assets")
    .select(ASSET_SELECT)
    .eq("coingecko_id", cg)
    .maybeSingle()
  if (error) return null
  return (data ?? null) as AssetRow | null
}

async function ensureAssetMetaInline(cg: string, ms: number): Promise<void> {
  try {
    await Promise.race([
      ensureAssetMeta(cg, { wait: true }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("ensure-inline-timeout")), ms)
      }),
    ])
  } catch {
    // Timeout/error must not block the storefront. The in-flight ensure keeps
    // running and will bust the per-coin links cache after a successful upsert,
    // so a subsequent request can pick up the snapshot.
  }
}

async function loadCuratedLinks(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  assetId: string,
): Promise<Link[]> {
  const { data, error } = await supabase
    .from("links")
    .select(
      "id, asset_id, name, description, href, tier, category, health, is_top, manual_rank, ai_score, icon",
    )
    .eq("asset_id", assetId)
    .order("tier", { ascending: true })
    .order("is_top", { ascending: false, nullsFirst: false })
    .order("manual_rank", { ascending: true, nullsFirst: false })
    .order("ai_score", { ascending: false, nullsFirst: false })

  if (error) return []
  return (data ?? []) as Link[]
}

function emptyPayload(): LinksPayload {
  return {
    asset: null,
    links: [],
    categories: [],
    generated: false,
    status: "undescribed",
  }
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
    const prevScoped = prev.asset_id != null
    const nextScoped = r.asset_id != null
    if (!prevScoped && nextScoped) {
      byKey.set(r.key, r)
    }
  }
  return Array.from(byKey.values())
}
