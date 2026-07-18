// lib/drawer-state.ts
// Module-level store for the global asset drawer state. Mounted globally
// in `Providers`, the drawer reacts to this store instead of a Next route
// so opening costs zero network round trips — the route navigation that
// previously stalled dev (intercepting route) and prod (route change) is
// gone. The URL is mirrored for shareable links and browser back/forward
// via direct history APIs in `useDrawerUrlSync` and `useOpenAsset`.

import { useSyncExternalStore } from "react"
import type { MarketRow } from "@/lib/types"

export interface DrawerState {
  /** The CoinGecko id of the open coin, or null if no drawer is open. */
  id: string | null
  /** Latest known market snapshot for the open coin (for instant header). */
  market: MarketRow | null
}

const listeners = new Set<() => void>()
let state: DrawerState = { id: null, market: null }

function emit() {
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDrawerState(): DrawerState {
  return state
}

export function openDrawer(rowOrId: MarketRow | string): void {
  const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
  const market = typeof rowOrId === "string" ? null : rowOrId
  // Don't open if already open for the same id (cheap idempotency).
  if (state.id === id && state.market === market) return
  state = { id, market }
  emit()
}

export function closeDrawer(): void {
  if (state.id === null) return
  state = { id: null, market: null }
  emit()
}

export function useDrawerId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.id,
    () => null,
  )
}

export function useDrawerMarket(): MarketRow | null {
  return useSyncExternalStore(
    subscribe,
    () => state.market,
    () => null,
  )
}
