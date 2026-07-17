"use client"

// useOpenAsset — opens the global AssetDrawer overlay. The drawer is
// mounted once in <Providers> on the storefront layout and reads its
// open/id from `lib/drawer-state` — there is no router.push, no RSC
// payload, no Intercepting Route. Click → URL change + drawer state
// change → drawer renders in the very next frame, with zero network.
//
// URL SYNC (shareable links + back/forward):
//   open  → window.history.pushState(null, "", "/asset/<id>")
//   close → window.history.back()   (reverts to the URL we replaced)
//   popstate → sync state from the URL (browser Back/Forward buttons).

import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  openDrawer,
  closeDrawer,
  useDrawerId,
} from "@/lib/drawer-state"
import { stashMarketRow } from "@/lib/prefetch"
import type { MarketRow } from "@/lib/types"

export function useOpenAsset() {
  const qc = useQueryClient()
  const currentId = useDrawerId()

  const open = useCallback(
    (rowOrId: MarketRow | string) => {
      const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
      if (typeof rowOrId !== "string") stashMarketRow(qc, rowOrId)

      // URL: push a new entry only if the active URL isn't already
      // /asset/<id>. Reopening the same coin must not stack history.
      const target = `/asset/${id}`
      const isOnAsset = typeof window !== "undefined" &&
        window.location.pathname === target
      if (typeof window !== "undefined") {
        if (!isOnAsset) {
          window.history.pushState(null, "", target)
        }
        // Else: drawer already shows this id — leave URL alone.
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
      if (window.location.pathname.startsWith("/asset/")) {
        window.history.back()
      }
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
