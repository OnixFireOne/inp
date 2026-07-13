"use client"

// useOpenAsset — opens the /asset/[id] modal from any surface (table row,
// beeswarm tile, …). On the intercepted route the modal slot mounts
// AssetDrawer; on a hard navigation the full SEO page renders instead.
//
// Hover-time route prefetch lives here too: `prefetchAsset(id)` calls
// Next's router.prefetch so the RSC payload for the intercepted modal is
// warm before click. Without this the route navigation is the main
// remaining delay on a cold cache — even when /api/links is hot.
//
// We deduplicate both the data prefetch (RQ) and the route prefetch (RSC)
// per-id to avoid hammering the network when the user scans a long list.

import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { stashMarketRow } from "@/lib/prefetch"
import type { MarketRow } from "@/lib/types"

// Module-level set — survives across component instances but is per-tab.
// Cheap dedupe of `router.prefetch("/asset/<id>")` calls.
const routerPrefetched = new Set<string>()

export function useOpenAsset() {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()

  function navigate(id: string) {
    if (pathname?.startsWith("/asset/")) {
      router.replace(`/asset/${id}`, { scroll: false })
    } else {
      router.push(`/asset/${id}`, { scroll: false })
    }
  }

  function open(rowOrId: MarketRow | string) {
    const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
    if (typeof rowOrId !== "string") stashMarketRow(qc, rowOrId)
    // Mark the route as prefetched — we're about to navigate, so any
    // hover-prefetch work is already paid for.
    routerPrefetched.add(id)
    navigate(id)
  }

  /**
   * Hover-time route prefetch. Cheap because Next dedupes internally; we
   * also gate at this layer so a long list scan only triggers one
   * `router.prefetch` per coin per tab.
   */
  function prefetch(rowOrId: MarketRow | string) {
    const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
    if (routerPrefetched.has(id)) return
    routerPrefetched.add(id)
    if (typeof window === "undefined") return
    // `router.prefetch` is a no-op for the current route and on most
    // hard-cached routes; calling it on every hover of the same coin
    // would still cost nothing extra once warmed, but the Set gate keeps
    // logs clean and respects the user's data budget on mobile.
    try {
      router.prefetch(`/asset/${id}`)
    } catch {
      /* prefetch is best-effort */
    }
  }

  return { open, prefetch }
}