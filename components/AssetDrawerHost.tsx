"use client"

// AssetDrawerHost — always mounted, listens to the global drawer state,
// renders <AssetDrawer open={state.id !== null} coingeckoId={state.id} />
// and wires its onClose back to history.back(). Lives inside <Providers>
// next to <ChartModal> so both overlay surfaces share the same global
// mount slot.

import { AssetDrawer } from "./AssetDrawer"
import { useDrawerId, useDrawerMarket } from "@/lib/drawer-state"
import { useDrawerUrlSync } from "@/lib/drawer-url-sync"

export function AssetDrawerHost() {
  // Wire popstate → drawer state.
  useDrawerUrlSync()
  const id = useDrawerId()
  const market = useDrawerMarket()
  return (
    <AssetDrawer
      open={id !== null}
      onOpenChange={(o) => { if (!o && id) window.history.back() }}
      coingeckoId={id}
      market={market ?? undefined}
    />
  )
}