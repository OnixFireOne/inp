"use client"
// components/admin/CatalogTable.tsx
// Stage 1 "Catalog of coins" — gaps view.
//   - markets  -> useList(dataProviderName="markets")  (live CoinGecko)
//   - assets   -> useList()                            (described overlay)
//   - filter: all / described / missing + search by name/symbol
//   - pagination: load-more (page++) — no total from /api/markets
import { useEffect, useMemo, useState } from "react"
import { useList } from "@refinedev/core"
import { StatusBadge } from "./StatusBadge"
import type { MarketRow } from "@/lib/types"

type Filter = "all" | "described" | "missing"

type Described = {
  coingecko_id: string
  id: string
  name: string
  ticker: string
  icon: string | null
  links: { count: number }[]
}

export function CatalogTable({
  onSelect,
}: {
  onSelect: (row: MarketRow, described: Described | undefined) => void
}) {
  // --- markets (live CoinGecko) ---
  const [page, setPage] = useState(1)
  const [accumulated, setAccumulated] = useState<MarketRow[]>([])

  const markets = useList<MarketRow>({
    resource: "markets",
    dataProviderName: "markets",
    pagination: { currentPage: page, pageSize: 100, mode: "server" },
  })

  // /api/markets returns `total = -1` while hasMore=true; otherwise total
  // matches the number of rows we got.
  const total = markets.query.data?.total
  const hasMore = total === -1

  // Append each freshly-fetched page to `accumulated`. Use a set guard so
  // React Query refetches on focus don't double rows.
  useEffect(() => {
    const rows = markets.query.data?.data
    if (!rows) return
    setAccumulated((prev) => {
      const known = new Set(prev.map((r) => r.id))
      const next = rows.filter((r) => !known.has(r.id))
      return next.length ? [...prev, ...next] : prev
    })
  }, [markets.query.data])

  // --- described overlay (Supabase) ---
  const assets = useList<Described>({
    resource: "assets",
    pagination: { currentPage: 1, pageSize: 1000, mode: "server" },
  })

  const describedMap = useMemo(() => {
    const m = new Map<string, Described>()
    for (const a of assets.query.data?.data ?? []) {
      m.set(a.coingecko_id, a)
    }
    return m
  }, [assets.query.data])

  // --- ui state ---
  const [filter, setFilter] = useState<Filter>("all")
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return accumulated.filter((r) => {
      if (needle && !r.name.toLowerCase().includes(needle) && !r.symbol.toLowerCase().includes(needle)) {
        return false
      }
      const d = describedMap.get(r.id)
      if (filter === "described" && !d) return false
      if (filter === "missing" && d) return false
      return true
    })
  }, [accumulated, q, filter, describedMap])

  const loading = markets.query.isLoading || markets.query.isFetching

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по name / symbol…"
          className="border rounded px-3 py-1.5 text-sm w-64 bg-[var(--surface)]"
        />
        <FilterBtn value="all" current={filter} onChange={setFilter}>
          Все <span className="text-[var(--text-mut)]">({accumulated.length})</span>
        </FilterBtn>
        <FilterBtn value="described" current={filter} onChange={setFilter}>
          Описанные <span className="text-[var(--text-mut)]">({describedMap.size})</span>
        </FilterBtn>
        <FilterBtn value="missing" current={filter} onChange={setFilter}>
          Не описанные
        </FilterBtn>
        <div className="ml-auto text-xs text-[var(--text-mut)]">
          стр. {page}{hasMore ? "" : " · конец"}
        </div>
      </div>

      {assets.query.error && (
        <div className="text-xs text-amber-600">
          Оверлей статуса недоступен: {String((assets.query.error as unknown as Error).message ?? assets.query.error)}
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface)] text-left">
            <tr className="text-xs uppercase text-[var(--text-mut)]">
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Монета</th>
              <th className="px-3 py-2 text-right">Цена</th>
              <th className="px-3 py-2 text-right">24ч</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const d = describedMap.get(r.id)
              const linkCount = Array.isArray(d?.links) && d.links[0]?.count != null
                ? Number(d!.links![0].count)
                : undefined
              return (
                <tr
                  key={r.id}
                  className="border-t hover:bg-[var(--surface)]/50 cursor-pointer"
                  onClick={() => onSelect(r, d)}
                >
                  <td className="px-3 py-2 text-[var(--text-mut)]">{r.rank || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {r.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" className="w-5 h-5 rounded-full" />
                      )}
                      <span className="font-medium">{r.name}</span>
                      <span className="text-[var(--text-mut)] text-xs uppercase">{r.symbol}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">${r.price.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.change24h >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {r.change24h.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2"><StatusBadge described={d} linkCount={linkCount} /></td>
                  <td className="px-3 py-2 text-right">
                    <span className="text-xs text-[var(--text-mut)]">открыть →</span>
                  </td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--text-mut)]">Нет строк</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3 h-10 text-xs text-[var(--text-mut)]">
        {loading && "загрузка…"}
        {!loading && hasMore && (
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded border text-xs"
          >
            Загрузить ещё 100
          </button>
        )}
        {!loading && !hasMore && "— это всё —"}
      </div>
    </div>
  )
}

function FilterBtn({
  value, current, onChange, children,
}: {
  value: Filter
  current: Filter
  onChange: (v: Filter) => void
  children: React.ReactNode
}) {
  const active = value === current
  return (
    <button
      onClick={() => onChange(value)}
      className={`px-3 py-1.5 text-sm rounded border ${active ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-foreground"}`}
    >
      {children}
    </button>
  )
}
