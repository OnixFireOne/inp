"use client"

// Intercepting route for the @modal parallel slot.
// Soft navigation /asset/[id] → renders this (modal overlay above the list).
// Direct URL /asset/[id] → renders app/asset/[id]/page.tsx (full page).
//
// DATA STRATEGY:
//   No new fetch. The AssetDrawer reads via the SAME ["links", id] queryKey
//   that AssetRow prefetched on hover. When the user lands here via
//   router.push (from a hovered row), the cache is hot → instant render.
//   On a hard navigation to /asset/[id] we cold-start the prefetch ourselves.

import { AssetDrawer } from "@/components/AssetDrawer"
import { use, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { prefetchLinks, marketRowQueryKey } from "@/lib/prefetch"
import { usePathname } from "next/navigation"
import type { MarketRow } from "@/lib/types"

interface AssetModalPageProps {
  params: Promise<{ id: string }>
}

export default function AssetModalPage({ params }: AssetModalPageProps) {
  const { id } = use(params)
  const qc = useQueryClient()
  const pathname = usePathname()

  // Guard: only render the modal when the URL is /asset/[id].
  // Direct visits to the full /asset/[id] page don't include this slot
  // (Next renders app/asset/[id]/page.tsx directly).
  if (!pathname?.startsWith("/asset/")) return null

  const marketRow = qc.getQueryData<MarketRow>(marketRowQueryKey(id))
  const market = marketRow ?? undefined

  // On mount: ensure the cache is warm (no-op if already prefetched on hover).
  useEffect(() => {
    prefetchLinks(qc, id)
  }, [qc, id])

  function handleClose() {
    window.history.back()
  }

  return (
    <AssetDrawer
      open={true}
      onOpenChange={(o) => { if (!o) handleClose() }}
      coingeckoId={id}
      market={market}
    />
  )
}
