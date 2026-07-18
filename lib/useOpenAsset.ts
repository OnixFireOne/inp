"use client"

// useOpenAsset — opens the global AssetDrawer overlay. The drawer is
// mounted once in <Providers> on the storefront layout and reads its
// open/id from `lib/drawer-state` — there is no router.push, no RSC
// payload, no Intercepting Route. Click → URL change + drawer state
// change → drawer renders in the very next frame, with zero network.
//
// URL SYNC (shareable links + back/forward):
//   open from catalog    → window.history.pushState(null, "", "/asset/<id>")
//   open while drawer up → window.history.replaceState(null, "", "/asset/<id>")
//                          (single /asset/* entry on top of the catalog —
//                           switching coins never grows history)
//   close → window.history.back()   (reverts the single /asset/* entry)
//   popstate → sync state from the URL (browser Back/Forward buttons).

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  openDrawer,
  closeDrawer,
  useDrawerId,
} from "@/lib/drawer-state"
import { stashMarketRow } from "@/lib/prefetch"
import {
  pushOrReplaceDrawerUrl,
  maybeBackFromAsset,
} from "@/lib/drawer-history"
import type { MarketRow } from "@/lib/types"

export function useOpenAsset() {
  const qc = useQueryClient()
  const currentId = useDrawerId()

  const open = useCallback(
    (rowOrId: MarketRow | string) => {
      const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
      if (typeof rowOrId !== "string") stashMarketRow(qc, rowOrId)

      // History invariant: at most one /asset/* entry above the catalog.
      //   - opening from a non-/asset URL  → pushState (the first entry)
      //   - switching coins while drawer is up → replaceState (same slot)
      //   - reopening the coin already shown → no history op at all
      if (typeof window !== "undefined") {
        pushOrReplaceDrawerUrl(
          { history: window.history, location: window.location },
          id,
        )
      }
      openDrawer(rowOrId)
    },
    [qc],
  )

  const close = useCallback(() => {
    closeDrawer()
    if (typeof window !== "undefined") {
      // Prefer history.back so the user's previous URL is restored exactly.
      // Only go back if the current entry IS the asset page (guard against
      // reopening via menu / external nav landing us on /asset/[id]).
      maybeBackFromAsset({
        history: window.history,
        location: window.location,
      })
    }
  }, [])

  // The previous hook returned a `prefetch` helper for the RSC payload
  // of the intercepted route. With local-state routing the drawer has
  // no RSC dependency; data prefetch happens through `prefetchLinks`
  // in `lib/prefetch.ts`. We keep the function shape stable for callers
  // that still destructure `{ prefetch }` — it's now a deliberate no-op.
  const prefetch = useCallback((_rowOrId: MarketRow | string) => {
    /* no-op — drawer data is hydrated via prefetchLinks (RQ), not RSC */
  }, [])

  return { open, close, prefetch, currentId }
}
