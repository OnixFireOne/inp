"use client"
// app/(admin)/admin/catalog/[id]/page.tsx
// Asset modal route. We use a dedicated URL (not a `<Dialog>`) so the
// editor is shareable, deep-linkable, and survives reload.
//
// ?cg=<coingecko_id> is passed by the catalog table for both described
// and un-described coins. We pull the market row from the `markets`
// data provider (getOne scans a few pages) and the described overlay
// from `assets` to decide edit vs add.
import { useMemo } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useOne, useList } from "@refinedev/core"
import { AssetEditor } from "@/components/admin/AssetEditor"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
}

export default function CatalogAssetPage() {
  const params = useParams<{ id: string }>()
  const sp = useSearchParams()
  const router = useRouter()
  const cgId = sp.get("cg") ?? params.id

  // Market row via the "markets" data provider.
  const marketQuery = useOne<MarketRow>({
    resource: "markets",
    id: cgId,
    queryOptions: { enabled: !!cgId, retry: 0 },
  })
  const market = marketQuery.query.data?.data ?? null

  // Described overlay — we only need the one row for this coingecko_id.
  // We pull a small list once and pick; useList keeps it cacheable so
  // the catalog table and this page share the same data.
  const assetsQuery = useList<Described>({
    resource: "assets",
    pagination: { currentPage: 1, pageSize: 1000, mode: "server" },
  })
  const described = useMemo(
    () => assetsQuery.query.data?.data?.find((a: Described) => a.coingecko_id === cgId),
    [assetsQuery.query.data, cgId],
  )

  const title = useMemo(() => {
    if (described) return `Редактирование: ${described.name}`
    if (market) return `Добавить: ${market.name}`
    return `Монета: ${cgId}`
  }, [described, market, cgId])

  const err = marketQuery.query.error ?? assetsQuery.query.error

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4 max-w-3xl mx-auto">
        <header className="mb-4 flex items-center gap-2">
          <button
            onClick={() => router.push("/admin/catalog")}
            className="text-sm text-[var(--text-mut)] hover:underline"
          >
            ← к каталогу
          </button>
          <h1 className="text-xl font-medium ml-2">{title}</h1>
        </header>
        {err && <div className="text-sm text-rose-600 mb-3">{String((err as unknown as Error).message ?? err)}</div>}
        {market ? (
          <AssetEditor
            market={market}
            existing={described}
            onClose={() => router.push("/admin/catalog")}
          />
        ) : (
          <div className="text-sm text-[var(--text-mut)]">загрузка…</div>
        )}
      </div>
    </main>
  )
}
