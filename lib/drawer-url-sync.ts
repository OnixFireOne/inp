"use client"

// useDrawerUrlSync — keeps `lib/drawer-state` mirrored to the URL, with
// the constraint that opening a row is INSTANTANEOUS on click (no
// router.push). The drawer calls `window.history.pushState` directly;
// this hook subscribes to popstate (browser Back/Forward + manual history
// calls) and to the drawer's open/close actions, translating them into
// drawer-state mutations.
//
// Additionally it supports the deep-link case: if the user lands on
// `/asset/[id]` via a fresh page load, refresh, or share-link click, the
// drawer should appear above the catalog page. That's handled by reading
// `window.location.pathname` on first render — but in this app that
// case is owned by `app/asset/[id]/page.tsx` itself: a deep link to that
// path renders the SEO page. We DON'T auto-overlay on the catalog page
// because that would cover the user's landing content with content
// rendered for a different route — confusing for crawlers and screen
// readers. Catalog users click rows to open the drawer.

import { useEffect } from "react"
import { getDrawerState, openDrawer, closeDrawer } from "./drawer-state"

export function useDrawerUrlSync(): void {
  useEffect(() => {
    if (typeof window === "undefined") return

    function onPopState() {
      // On Back/Forward: the URL already tells us what should be open.
      const path = window.location.pathname
      const m = /^\/asset\/([^/]+)$/.exec(path)
      if (m) {
        const id = decodeURIComponent(m[1])
        // Only mutate if it's not already open — the close handler also
        // calls history.back(), which would otherwise re-open the same id.
        if (getDrawerState().id !== id) {
          openDrawer(id)
        }
      } else if (getDrawerState().id !== null) {
        closeDrawer()
      }
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])
}
