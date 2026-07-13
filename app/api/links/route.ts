// app/api/links/route.ts
// Drawer data source. CoinGecko drives the table; this route joins curated
// links from Supabase by coingecko_id on click (with hover-prefetch). If a
// coin has no curated links yet, it returns virtual links generated from
// link_templates + cached provider metadata.
//
//   GET /api/links?cg=<coingeckoId>
//   -> { asset, links, categories, generated, status }
//
// PERFORMANCE NOTES
//   • Cached at the edge: TTL = LINKS_TTL_SECONDS (default 6h) for FULL
//     payloads (meta present + curated links or composed templates).
//     DEGRADED payloads (cold-path timeout, no meta, empty links) get a
//     short TTL_DEGRADED_SECONDS (default 60s) and a one-shot retry via
//     the in-flight ensure → bustLinkCaches path. Without this split, a
//     5s ensure-timeout would lock the empty payload behind a 6h CDN cache
//     and the eventual successful upsert wouldn't be visible for hours.
//   • On a cold first read for a template coin, the CoinGecko snapshot is
//     warmed IN PARALLEL with categories / templates / marketRow. We then
//     re-read asset, curated links, AND asset_meta AFTER ensure settles —
//     the initial meta read starts before ensure, so without the second
//     read we'd cache an empty-meta payload for mem-coins whose snapshot
//     is being inserted right now. contract chip & template {contract}
//     substitutions would break.
//   • No asset/categories/templates reads are started before the
//     `ensureAssetMetaInline` call — when we DO need the snapshot, it can
//     create the asset stub and the asset_id reference, so we wait for it
//     before composing. But the I/O we already kicked off (templates,
//     meta, marketRow, categories) keeps streaming.

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
  /** Native-chain contract address from the CG snapshot, or null. */
  contract: { chain: string; address: string } | null
}

// Default 6h. Curated links + categories + asset identity only change when
// an admin edits them (bumping the KV cache version), so a long edge TTL is
// safe and avoids hammering Supabase on every repeat open.
const TTL = Number(process.env.LINKS_TTL_SECONDS ?? 6 * 60 * 60)
// Short TTL for DEGRADED responses (cold-path timeout, meta absent, links
// empty). Keeps the storefront responsive while letting the in-flight
// ensure → bustLinkCaches path take effect within one minute.
const TTL_DEGRADED_SECONDS = Number(
  process.env.LINKS_TTL_DEGRADED_SECONDS ?? 60,
)
const ENSURE_INLINE_TIMEOUT_MS = Number(
  process.env.ENSURE_INLINE_TIMEOUT_MS ?? 5000,
)

const ASSET_SELECT =
  "id, name, ticker, icon, coingecko_id, tv_symbol, category_orders, status"

export async function GET(req: NextRequest) {
  const cg = (req.nextUrl.searchParams.get("cg") ?? "").trim()
  if (!cg) return json(emptyPayload(), 200, TTL_DEGRADED_SECONDS)

  const cacheKey = await getLinkCacheKey(cg)
  const cached = await kvGet<LinksPayload>(cacheKey)
  if (cached) return json(cached, 200, TTL)

  const supabase = await supabaseServer()
  // Asset first: we need its id to load curated links and scoped categories.
  let asset = await loadAsset(supabase, cg)
  let curated = asset ? await loadCuratedLinks(supabase, asset.id) : ([] as Link[])

  // Cold/template coin without curated links: do the snapshot warm INLINE
  // but run it concurrently with every other read below. Described/curated
  // coins skip this branch entirely.
  const needsSnapshot =
    (!asset || asset.status === "template") && (curated?.length ?? 0) === 0

  // Fire the ensure immediately. We await its slot in the Promise.all below
  // so the entire response waits at most ENSURE_INLINE_TIMEOUT_MS, not
  // (ensure + everything else).
  const ensurePromise: Promise<void> = needsSnapshot
    ? ensureAssetMetaInline(cg, ENSURE_INLINE_TIMEOUT_MS)
    : Promise.resolve()

  // Meta read also runs in parallel — on the WARM path (needsSnapshot ===
  // false) this is the only read we need, so we save the roundtrip we'd
  // pay by re-reading after ensure. On the COLD path we IGNORE this
  // response and re-read after ensure settles, because the snapshot is
  // being inserted in parallel and the early read will return null.
  const metaPromise = supabase
    .from("asset_meta")
    .select("data")
    .eq("asset_id", asset?.id ?? cg)
    .eq("provider", "coingecko")
    .maybeSingle() as unknown as Promise<{ data: { data: unknown } | null }>

  // Kick off everything else in parallel. None of these depends on the
  // ensure outcome *for a cached coin* (needsSnapshot === false). On the
  // cold path we'll re-read asset/curated/meta AFTER ensure settles, but
  // the network roundtrips for templates / categories / marketRow run
  // alongside the snapshot fetch.
  const [marketRow, templates, categoriesRaw] = await Promise.all([
    getMarketRowFromCache(cg),
    getActiveTemplates(),
    loadCategories(supabase, asset?.id ?? cg, !!asset),
    ensurePromise, // joined here — gate the response on max(timeout, reads)
  ])
  const metaEarlyResp = await metaPromise

  // If ensure ran, the stub might have been created and meta cached. Re-read
  // the asset row, curated links, AND meta so the payload reflects the
  // now-warm snapshot.
  let metaRecord: { data: unknown } | null = metaEarlyResp?.data ?? null
  if (needsSnapshot) {
    asset = await loadAsset(supabase, cg)
    curated = asset ? await loadCuratedLinks(supabase, asset.id) : ([] as Link[])
    const { data: metaFresh } = await supabase
      .from("asset_meta")
      .select("data")
      .eq("asset_id", asset?.id ?? cg)
      .eq("provider", "coingecko")
      .maybeSingle()
    if (metaFresh?.data) metaRecord = metaFresh
  }

  // Enrich minimal stubs without blocking render and without overwriting data.
  maybeBackfillAssetFromMarket(asset, marketRow)

  const assetId = asset?.id ?? cg
  const orderedCategories = applyCategoryOrder(
    dedupeCategoriesByKey(categoriesRaw),
    asset?.category_orders ?? null,
  )

  const meta = (metaRecord?.data ?? null) as Record<string, unknown> | null

  const assetVars = buildAssetVars(cg, asset, marketRow)
  const composed = composeLinksPayload<CategoryMeta>({
    asset,
    assetId,
    curated,
    categories: orderedCategories,
    templates,
    assetVars,
    metaByProvider: meta ? { coingecko: meta } : {},
  })

  const contract = pickNativeContract(meta)
  const payload: LinksPayload = { ...composed, contract }

  // DEGRADED payload detection. The cold path can return a USABLE response
  // even without meta (generic templates with {slug}/{symbol} substitutions
  // work fine), so the previous "links.length===0 && !generated &&
  // !contract && !meta" test was too narrow — a {generated:true, meta:null}
  // payload would have been cached at full TTL despite missing the contract
  // chip and dex-specific links. The robust signal is: did the snapshot
  // we wanted (meta) actually arrive? If we entered the cold path and meta
  // is still missing, treat the response as degraded — bustLinkCaches from
  // the in-flight ensure will retire this short-TTL entry within seconds.
  const isDegraded = needsSnapshot && !meta

  const ttlSeconds = isDegraded ? TTL_DEGRADED_SECONDS : TTL
  await kvSetEx(cacheKey, ttlSeconds, payload)
  return json(payload, 200, ttlSeconds)
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
    // Timeout/error must not block the storefront. The in-flight ensure
    // keeps running and will (on success) upsert asset_meta AND call
    // bustLinkCaches(cg) — see lib/asset-meta/ensure.ts:154. That bust
    // retires the short-TTL degraded payload we just wrote above, so the
    // next request will recompute and cache the proper payload. Do NOT
    // long-cache a degraded response or the bust becomes a no-op.
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
    contract: null,
  }
}

function json(data: unknown, status = 200, ttlSeconds = TTL) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      // Mirror the KV TTL on the edge cache so CDN and origin agree.
      // stale-while-revalidate kept short so a freshly-invalidated payload
      // doesn't keep serving from CDN after admin edits or a delayed
      // ensure-meta upsert.
      "cache-control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=60`,
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

// Pick the native-chain contract address from a CoinGecko snapshot, or null
// if the asset is a native coin (BTC/ETH/DOGE etc.) or the snapshot is
// missing. Used by the drawer to show the "Copy contract" chip.
function pickNativeContract(
  meta: Record<string, unknown> | null | undefined,
): { chain: string; address: string } | null {
  if (!meta || typeof meta !== "object") return null
  const native = (meta as { asset_platform_id?: unknown }).asset_platform_id
  const dp = (meta as { detail_platforms?: Record<string, unknown> }).detail_platforms
  if (typeof native !== "string" || !native) return null
  if (!dp || typeof dp !== "object") return null
  const info = dp[native] as { contract_address?: unknown } | undefined
  if (!info || typeof info !== "object") return null
  const addr = typeof info.contract_address === "string" ? info.contract_address.trim() : ""
  if (!addr) return null
  return { chain: native, address: addr }
}