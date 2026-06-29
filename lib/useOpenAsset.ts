"use client"

import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { stashMarketRow } from "@/lib/prefetch"
import type { MarketRow } from "@/lib/types"

export function useOpenAsset() {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()

  return (rowOrId: MarketRow | string) => {
    const id = typeof rowOrId === "string" ? rowOrId : rowOrId.id
    if (typeof rowOrId !== "string") stashMarketRow(qc, rowOrId)
    if (pathname?.startsWith("/asset/")) {
      router.replace(`/asset/${id}`, { scroll: false })
    } else {
      router.push(`/asset/${id}`, { scroll: false })
    }
  }
}