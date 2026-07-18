// lib/prefetch.ts
// Prefetch /api/links into the React Query cache on hover/pointerdown.
// Uses the SAME queryKey as AssetDrawer → opening the modal reads from cache,
// no network. Tuned for "instant open" UX:
//
//   - LinksPayload has two shards:
//       * curated/template links & categories → stable for hours (admin edits
//         invalidate via /api/admin/invalidate-link-caches).
//       * coin identity (asset row)         → similarly stable.
//     RQ staleTime 12h, gcTime 24h → repeat opens (A → B → A) are pure
//     cache hits with zero refetch and zero skeleton.
//
//   - On hover we DEBOUNCE 150ms before kicking off the network. Hovering
//     a long row of coins costs ~1 request, not 50. On touch devices that
//     have no hover, pointerdown is the equivalent signal.

import type { QueryClient } from "@tanstack/react-query"
import type { Asset, Link } from "@/types/asset"
import type { MarketRow } from "@/lib/types"

export interface LinksPayload {
  asset: Pick<Asset, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links: Link[]
  categories: { key: string; label: string; icon: string | null; sort: number }[]
  generated?: boolean
  status?: "described" | "template" | "undescribed"
  /** Native-chain contract address from the CG snapshot, plus its chain key. */
  contract?: { chain: string; address: string } | null
  /** True only on the prefetch path when meta is missing. The client
   *  renders partial links + shimmer reservations and triggers a full
   *  /api/links in the background to upgrade the payload. */
  partial?: boolean
  /** Per-category reserved shimmer slot counts. */
  pending?: { categoryKey: string; count: number }[]
  /** True if at least one kind=provider template is pending on meta. */
  hasProviderPending?: boolean
  /** True if any {contract} pattern template is pending on meta. */
  hasContractPending?: boolean
}

export const linksQueryKey = (coingeckoId: string) => ["links", coingeckoId] as const
export const marketRowQueryKey = (id: string) => ["market-row", id] as const

// /api/links staleness policy. Curated links + categories + asset identity
// change via admin mutations, which bump the KV version token — the key
// itself retires old payloads. So treating the cache as fresh for 12h is
// safe for storefront UX.
const LINKS_STALE_MS = 12 * 60 * 60 * 1000 // 12h
const LINKS_GC_MS = 24 * 60 * 60 * 1000 // 24h

// /api/markets-derived market row (price/%24h/marketCap/sparkline). Lives
// in a SHORT timer: real prices move.
const MARKET_ROW_STALE_MS = 60 * 1000 // 60s

const HOVER_DEBOUNCE_MS = 150

/**
 * Fetch /api/links. `prefetch=true` switches the route to the no-ensure
 * path: it does NOT touch CoinGecko (no quota burnt on hovers that may
 * never become clicks), and the response carries `partial=true` on cold
 * coins so the client can reserve shimmer slots and trigger a full fetch
 * in the background.
 */
export async function fetchLinksPayload(
  cg: string,
  opts: { signal?: AbortSignal; prefetch?: boolean } = {},
): Promise<LinksPayload> {
  const url = `/api/links?cg=${encodeURIComponent(cg)}${opts.prefetch ? "&prefetch=1" : ""}`
  const r = await fetch(url, { signal: opts.signal })
  if (!r.ok) return { asset: null, links: [], categories: [], partial: true }
  return (await r.json()) as LinksPayload
}

export function prefetchLinks(qc: QueryClient, coingeckoId: string) {
  if (typeof window === "undefined") return
  void qc.prefetchQuery({
    queryKey: linksQueryKey(coingeckoId),
    queryFn: ({ signal }) => fetchLinksPayload(coingeckoId, { signal, prefetch: true }),
    staleTime: LINKS_STALE_MS,
    gcTime: LINKS_GC_MS,
  })
}

// Debounced hover prefetch. Mouse moves fast over rows; we don't want to
// start a network fetch on every cursor delta. 150ms matches the threshold
// used by major data tables (Linear/Notion). On touch devices this is a
// no-op — pointerdown callers use `prefetchLinksOnPointerDown`.
const hoverTimers = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>()
function debounceById(qc: QueryClient, id: string, fn: () => void) {
  let bucket = hoverTimers.get(qc)
  if (!bucket) {
    bucket = new Map()
    hoverTimers.set(qc, bucket)
  }
  const prev = bucket.get(id)
  if (prev) clearTimeout(prev)
  const t = setTimeout(() => {
    bucket!.delete(id)
    fn()
  }, HOVER_DEBOUNCE_MS)
  bucket.set(id, t)
}

export function prefetchLinksOnHover(qc: QueryClient, coingeckoId: string) {
  if (typeof window === "undefined") return
  // Don't even schedule if the data is already hot — the user has opened this
  // coin moments ago, no need to refetch.
  const existing = qc.getQueryData(linksQueryKey(coingeckoId))
  if (existing) return
  debounceById(qc, coingeckoId, () => prefetchLinks(qc, coingeckoId))
}

// Touch / fast-click entry point: no debounce, fire on first contact. Cheap
// because an idle row that never gets touched never triggers a request.
export function prefetchLinksOnPointerDown(qc: QueryClient, coingeckoId: string) {
  if (typeof window === "undefined") return
  const existing = qc.getQueryData(linksQueryKey(coingeckoId))
  if (existing) return
  prefetchLinks(qc, coingeckoId)
}

export function stashMarketRow(qc: QueryClient, row: MarketRow) {
  if (typeof window === "undefined") return
  qc.setQueryData<MarketRow>(marketRowQueryKey(row.id), row)
}

export { LINKS_STALE_MS, LINKS_GC_MS, MARKET_ROW_STALE_MS }
