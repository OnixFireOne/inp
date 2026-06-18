"use client"
// app/(admin)/admin/catalog/page.tsx
// Stage 1 catalog screen. Server component is unnecessary here — the page
// is fully client-driven (auth was already checked in the admin layout).
// Row click navigates to /admin/catalog/<coingecko_id> which mounts the
// asset editor modal.
import { CatalogTable } from "@/components/admin/CatalogTable"
import { useRouter } from "next/navigation"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
}

export default function CatalogPage() {
  const router = useRouter()
  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4 max-w-6xl mx-auto">
        <header className="mb-4">
          <h1 className="text-xl font-medium">Каталог монет</h1>
          <p className="text-sm text-[var(--text-mut)]">
            Живой маркет CoinGecko. Описана = есть строка в <code>assets</code> + её ссылки.
          </p>
        </header>
        <CatalogTable
          onSelect={(row: MarketRow, described: Described | undefined) => {
            // described ? edit : add — we use the same route, the editor
            // page shows an "Add" panel for un-described coins.
            const target = described?.id ?? row.id
            router.push(`/admin/catalog/${encodeURIComponent(target)}?cg=${encodeURIComponent(row.id)}`)
          }}
        />
      </div>
    </main>
  )
}
