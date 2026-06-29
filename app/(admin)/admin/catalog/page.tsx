"use client"
// app/(admin)/admin/catalog/page.tsx
// Stage 1.2: editor opens as a client-state modal over the catalog.
// Row click sets `selected` → renders CoinEditorModal.
// No URL change, no intercepting routes.
import { useState } from "react"
import Link from "next/link"
import { CatalogTable } from "@/components/admin/CatalogTable"
import { CoinEditorModal } from "@/components/admin/CoinEditorModal"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
  status?: "described" | "template" | null
}

export default function CatalogPage() {
  const [selected, setSelected] = useState<{ row: MarketRow; described: Described | undefined } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4 max-w-6xl mx-auto">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-medium">Каталог монет</h1>
            <p className="text-sm text-[var(--text-mut)]">
              Живой маркет CoinGecko. Описана = есть строка в <code>assets</code> + её ссылки.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/link-templates" className="text-sm text-[var(--text-mut)] hover:text-[var(--text)] border rounded px-2.5 py-1.5 shrink-0">
              Шаблоны
            </Link>
            <Link href="/admin/link-categories" className="text-sm text-[var(--text-mut)] hover:text-[var(--text)] border rounded px-2.5 py-1.5 shrink-0">
              Категории
            </Link>
          </div>
        </header>
        <CatalogTable
          key={refreshKey}
          onSelect={(row: MarketRow, described: Described | undefined) => {
            setSelected({ row, described })
          }}
        />
      </div>

      {selected && (
        <CoinEditorModal
          row={selected.row}
          described={selected.described}
          onClose={() => setSelected(null)}
          onMaterialized={() => {
            setSelected(null)
            setRefreshKey((v) => v + 1)
          }}
        />
      )}
    </main>
  )
}
