"use client"

// SparklineCell — renders a row's sparkline.
//
// Default window is 7d, sourced from the parent MarketRow (one network call
// per page of /api/markets — no extra fan-out).
//
// When the user switches to 24h, the component fetches /api/sparklines once
// and remembers the choice for the rest of the session.

import { useQuery } from "@tanstack/react-query"
import { Sparkline } from "./Sparkline"
import type { SparkWindow } from "@/lib/types"

interface SparklineCellProps {
  coingeckoId: string
  defaultData?: number[]
  positive: boolean
  window: SparkWindow
}

interface SparkResp {
  series: Record<string, number[]>
}

export function SparklineCell({ coingeckoId, defaultData, positive, window }: SparklineCellProps) {
  // Only fire network request when the user has explicitly switched to 24h.
  const need24h = window === "24h"
  const { data, isLoading } = useQuery({
    queryKey: ["sparkline", coingeckoId, window],
    enabled: need24h,
    queryFn: async (): Promise<SparkResp> => {
      const r = await fetch(
        `/api/sparklines?ids=${encodeURIComponent(coingeckoId)}&window=24h`
      )
      if (!r.ok) return { series: {} }
      return r.json()
    },
    staleTime: 60_000,
  })

  const series = need24h ? data?.series?.[coingeckoId] : defaultData

  if (!series || series.length < 2) {
    if (need24h && isLoading) {
      return <span className="inline-block w-24 h-8 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
    }
    return <Sparkline data={defaultData} positive={positive} />
  }
  return <Sparkline data={series} positive={positive} />
}
