// lib/prefetch.ts
// Prefetch /api/links into the React Query cache on row hover.
// Uses the SAME queryKey as AssetDrawer → opening the modal reads from cache, no network.

import type { QueryClient } from "@tanstack/react-query"
import type { Asset, Link } from "@/types/asset"
import type { MarketRow } from "@/lib/types"

export interface LinksPayload {
  asset: Pick<Asset, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links: Link[]
  categories: { key: string; label: string; icon: string | null; sort: number }[]
}

export const linksQueryKey = (coingeckoId: string) => ["links", coingeckoId] as const
export const marketRowQueryKey = (id: string) => ["market-row", id] as const

export async function fetchLinksPayload(cg: string, signal?: AbortSignal): Promise<LinksPayload> {
  const r = await fetch(`/api/links?cg=${encodeURIComponent(cg)}`, { signal })
  if (!r.ok) return { asset: null, links: [], categories: [] }
  return (await r.json()) as LinksPayload
}

export function prefetchLinks(qc: QueryClient, coingeckoId: string) {
  if (typeof window === "undefined") return
  // Same queryKey as AssetDrawer → cache hit when the modal opens.
  void qc.prefetchQuery({
    queryKey: linksQueryKey(coingeckoId),
    queryFn: ({ signal }) => fetchLinksPayload(coingeckoId, signal),
    staleTime: 60_000,
  })
}

export function stashMarketRow(qc: QueryClient, row: MarketRow) {
  if (typeof window === "undefined") return
  qc.setQueryData<MarketRow>(marketRowQueryKey(row.id), row)
}
