// lib/asset-meta/ensure.ts
// Single entry point for fetching + caching the CoinGecko snapshot of one
// coin (`asset_meta`). Lazy stale-while-revalidate by default:
//   • fire-and-forget on the storefront (when stale)
//   • synchronous (`wait: true`) on the materialize endpoint
// See plan/link-templates-spec.md, sections "Аспект 4" + "Аспект 4.5".

import { kvDel, kvGet, kvSetEx, kvSetNx } from "../kv"
import { supabaseServer } from "../supabase/server"
import { COINGECKO_BASE, fetchCoinMeta } from "./coingecko"
import { isAllowedCgId } from "./markets-allowlist"
import { warmMarketRow } from "./markets-warm"
import { bustLinkCaches } from "./bust-link-cache"
import { ensureAssetStub } from "./stub"
import { tryConsume } from "./rate-limit"

const PROVIDER = "coingecko" as const

const TTL_DAYS = Number(process.env.CG_META_TTL_DAYS ?? 7)
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000
const NEG_TTL = Number(process.env.CG_META_NEG_TTL_SECONDS ?? 6 * 60 * 60) // 6h
const LOCK_TTL = 30 // seconds
const RATE_CAPACITY = Number(process.env.CG_META_BUCKET_CAPACITY ?? 30)
const RATE_WINDOW = Number(
  process.env.CG_META_BUCKET_WINDOW_SECONDS ?? 60,
) // free CG ~30/min
const RATE_BUCKET = "cg:budget:coingecko"

const negKey = (id: string) => `cg:neg:${id}`
const lockKey = (id: string) => `cg:lock:${id}`

export type EnsureOpts = {
  /** Skip the freshness check and the negative cache; always hit CG. */
  force?: boolean
  /**
   * When true, await the full fetch (used by the materialize endpoint).
   * When false (default), schedule the work and resolve immediately so the
   * storefront never blocks on CG.
   */
  wait?: boolean
}

export type EnsureResult =
  | { status: "fresh" | "updated" | "rate_limited" | "forbidden" | "skipped" }
  | { status: "negative_cached" }
  | { status: "fetched"; data: unknown }

/**
 * Ensure `asset_meta(asset_id=cg, provider='coingecko')` is fresh.
 *
 * Guard order:
 *   1. negative-cache    (id was 404 from CG/markets recently — unless force)
 *   2. fast allowlist    (warmed caches only; no network)
 *   3. freshness         (DB row younger than TTL — unless force)
 *   4. single-flight lock
 *   5. rate budget       (bounds both market warm and snapshot fetch)
 *   5b. cold market warm (single /coins/markets?ids=... under lock+budget)
 *   6. fetch + trim + ensureAssetStub + upsert
 *   7. release lock + bust storefront cache
 */
export function ensureAssetMeta(
  cg: string,
  opts?: EnsureOpts,
): Promise<EnsureResult> {
  const force = !!opts?.force
  const wait = !!opts?.wait
  const run = async (): Promise<EnsureResult> => doEnsure(cg, force)
  // Fire-and-forget by default; log failures so admin can spot them.
  if (!wait) {
    void run().catch((e) => console.warn("[asset-meta] bg", cg, String(e)))
    return Promise.resolve({ status: "skipped" })
  }
  return run()
}

async function doEnsure(cg: string, force: boolean): Promise<EnsureResult> {
  if (!cg) return { status: "skipped" }
  let warmedMarketRow: Awaited<ReturnType<typeof warmMarketRow>> = null

  // 1. Negative cache.
  if (!force) {
    const neg = await kvGet<string>(negKey(cg))
    if (neg) return { status: "negative_cached" }
  }

  // 2. Fast allowlist (cheap, warmed caches only; no network). If cold, we
  // decide later under the single-flight lock + rate budget.
  const allowedFast = await isAllowedCgId(cg)

  const supabase = await supabaseServer()

  // 3. Freshness.
  if (!force) {
    const fresh = await readFreshSnapshot(supabase, cg)
    if (fresh) return { status: "fresh" }
  }

  // 4. Single-flight lock.
  const got = await kvSetNx(lockKey(cg), LOCK_TTL, "1")
  if (!got) return { status: "skipped" }

  try {
    // 5. Rate budget.
    const ok = await tryConsume({
      bucketKey: RATE_BUCKET,
      capacity: RATE_CAPACITY,
      windowSeconds: RATE_WINDOW,
    })
    if (!ok) return { status: "rate_limited" }

    // 5b. Cold deep-link: not in any warmed markets page/id cache. Warm one
    // market row under the same lock+budget that protects the snapshot fetch.
    // Real coin → allowlist opens and ticker becomes available for {symbol};
    // nonsense id → negative-cache so repeat bot hits are cheap.
    if (!allowedFast) {
      const warmed = await warmMarketRow(cg)
      if (!warmed) {
        await kvSetEx(negKey(cg), NEG_TTL, "1")
        return { status: "forbidden" }
      }
      warmedMarketRow = warmed
    }

    // 6. Fetch.
    const result = await fetchCoinMeta(cg)
    if (!result.ok) {
      if (result.status === 404) {
        await kvSetEx(negKey(cg), NEG_TTL, "1")
        return { status: "negative_cached" }
      }
      return { status: "rate_limited" }
    }

    // FK pre-condition (item #2 in review): asset_meta.asset_id → assets(id).
    await ensureAssetStub(cg, warmedMarketRow)

    const { error } = await supabase
      .from("asset_meta")
      .upsert(
        {
          asset_id: cg,
          provider: PROVIDER,
          data: result.data,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "asset_id,provider" },
      )
    if (error) {
      console.warn("[asset-meta] upsert failed", cg, error.message)
      return { status: "rate_limited" }
    }

    // 7. Bust per-coin storefront cache (no-op until Aspect 5 wires it up).
    await bustLinkCaches(cg)

    return { status: "fetched", data: result.data }
  } finally {
    // Lock release is best-effort: TTL also bounds the worst case at 30s.
    void kvDel(lockKey(cg)).catch(() => {})
  }
}

type Supabase = Awaited<ReturnType<typeof supabaseServer>>

async function readFreshSnapshot(
  supabase: Supabase,
  cg: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("asset_meta")
    .select("fetched_at")
    .eq("asset_id", cg)
    .eq("provider", PROVIDER)
    .maybeSingle()
  if (error || !data) return false
  const ts = new Date((data as { fetched_at: string }).fetched_at).getTime()
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts < TTL_MS
}

// Re-export for tests + the upcoming materialize endpoint.
export const __internal = {
  COINGECKO_BASE,
  TTL_MS,
  NEG_TTL,
  LOCK_TTL,
  RATE_CAPACITY,
  RATE_WINDOW,
  RATE_BUCKET,
  negKey,
  lockKey,
}
