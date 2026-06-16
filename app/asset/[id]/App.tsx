"use client"

// AssetModal — a pure client component. Server pages only pass serializable data.
// Uses AssetDrawer for the overview. The ChartModal is a singleton that
// listens to global open-chart events (dispatched from the main table or
// any other place that calls requestOpenChart).

import { useRouter } from "next/navigation"
import { AssetDrawer } from "@/components/AssetDrawer"
import type { Asset } from "@/types/asset"

interface AssetModalProps {
  id: string
  asset?: Pick<Asset, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links?: any[]
}

export function AssetModal({ id, asset }: AssetModalProps) {
  const router = useRouter()
  const close = () => router.back()

  return (
    <>
      <AssetDrawer
        open={true}
        onOpenChange={(o) => { if (!o) close() }}
        coingeckoId={id}
        market={
          asset
            ? {
                name: asset.name,
                symbol: asset.ticker,
                image: asset.icon ?? "",
                price: 0,
                change24h: 0,
                marketCap: null,
              }
            : undefined
        }
      />

    </>
  )
}
