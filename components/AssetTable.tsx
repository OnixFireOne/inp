"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { AssetRow } from "./AssetRow"
import { requestOpenChart } from "./TvChart"
import type { MarketsResponse, MarketRow, SparkWindow } from "@/lib/types"
import { ThemeToggle } from "./ThemeToggle"

async function fetchMarkets(page: number): Promise<MarketsResponse> {
  const r = await fetch(`/api/markets?page=${page}`)
  if (!r.ok) throw new Error("Failed to load markets")
  return r.json()
}

interface AssetTableProps {
  /** SSR-prefetched data — eliminates skeleton → data CLS shift. */
  initialData?: MarketsResponse | null
}

export function AssetTable({ initialData }: AssetTableProps = {}) {
  const [page, setPage] = useState(1)
  const [sparkWindow, setSparkWindow] = useState<SparkWindow>("7d")
  const [show30d, setShow30d] = useState(false)
  const [show1y, setShow1y] = useState(false)
  const router = useRouter()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["markets", page],
    queryFn: () => fetchMarkets(page),
    // Use SSR prefetch as initial data; avoids skeleton flash on hydration.
    initialData: page === 1 ? initialData ?? undefined : undefined,
    staleTime: 30_000,
  })

  const rows: MarketRow[] = data?.rows ?? []
  const firstId = rows[0]?.id

  // Prefetch the intercepting route chunk for the first asset on the page.
  // Eliminates cold delay on first drawer open — works on desktop and mobile
  // without requiring a hover first.
  useEffect(() => {
    if (firstId) router.prefetch(`/asset/${firstId}`)
  }, [firstId, router])

  // Open the always-mounted chart panel via the global event channel.
  function openChart(row: MarketRow, symbol: string) {
    requestOpenChart({ symbol, name: row.name, ticker: row.symbol })
  }

  return (
    <div className="w-full max-w-[var(--maxw)] mx-auto">
      {/* Top bar (sticky, blur) */}
      <div className="sticky top-0 z-40 bg-[var(--bg)]/80 backdrop-blur border-b border-[var(--border)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-xl tracking-tight">
              INP<span className="text-[var(--accent)]">.one</span>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full max-w-[420px] mx-4">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search assets..."
                className="w-full bg-[var(--surface)] border border-[var(--border)] text-sm rounded-full pl-9 py-2 focus:outline-none focus:border-[var(--accent)]"
              />
              <svg className="absolute left-3 top-2.5 text-[var(--text-mut)] pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border border-[var(--border)] overflow-hidden">
              <button
                onClick={() => setShow30d((v) => !v)}
                className={`spark-toggle-btn px-2 py-1 cursor-pointer text-sm ${show30d ? "bg-[var(--surface-2)] text-[var(--text)]" : ""}`}
                aria-label="Toggle 30 day change"
                aria-pressed={show30d}
              >
                30d
              </button>
              <button
                onClick={() => setShow1y((v) => !v)}
                className={`spark-toggle-btn px-2 py-1 cursor-pointer text-sm ${show1y ? "bg-[var(--surface-2)] text-[var(--text)]" : ""}`}
                aria-label="Toggle 1 year change"
                aria-pressed={show1y}
              >
                1y
              </button>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-mut)]">
              <th className="px-4 py-3 w-12">#</th>
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Market Cap</th>
              <th className="px-4 py-3 text-right">24h</th>
              {show30d && <th className="px-4 py-3 text-right">30d</th>}
              {show1y && <th className="px-4 py-3 text-right">1y</th>}
              <th className="px-4 py-3 w-28 hidden md:table-cell">
                <div className="flex items-center justify-end text-xs text-[var(--text-mut)]">
                  <div className="flex items-center rounded-full border border-[var(--border)] overflow-hidden">
                    <button
                      onClick={() => setSparkWindow("7d")}
                      className={`spark-toggle-btn px-2 py-0.5 cursor-pointer ${sparkWindow === "7d" ? "bg-[var(--surface-2)] text-[var(--text)]" : ""}`}
                      aria-label="7 day sparkline"
                    >
                      7d
                    </button>
                    <button
                      onClick={() => setSparkWindow("24h")}
                      className={`spark-toggle-btn px-2 py-0.5 cursor-pointer ${sparkWindow === "24h" ? "bg-[var(--surface-2)] text-[var(--text)]" : ""}`}
                      aria-label="24 hour sparkline"
                    >
                      24h
                    </button>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="row-h border-b border-[var(--border)]">
                  <td className="px-4"><div className="w-6 h-4 bg-[var(--surface-2)] rounded animate-pulse" /></td>
                  <td className="px-4">
                    <div className="flex gap-3 items-center h-full">
                      <div className="w-7 h-7 bg-[var(--surface-2)] rounded-full animate-pulse shrink-0" />
                      <div className="space-y-1">
                        <div className="w-24 h-4 bg-[var(--surface-2)] rounded animate-pulse" />
                        <div className="w-10 h-3 bg-[var(--surface-2)] rounded animate-pulse" />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 text-right"><div className="w-20 h-4 bg-[var(--surface-2)] rounded animate-pulse ml-auto" /></td>
                  <td className="px-4 text-right hidden sm:table-cell"><div className="w-16 h-4 bg-[var(--surface-2)] rounded animate-pulse ml-auto" /></td>
                  <td className="px-4 text-right"><div className="w-14 h-4 bg-[var(--surface-2)] rounded animate-pulse ml-auto" /></td>
                  {show30d && <td className="px-4 text-right"><div className="w-14 h-4 bg-[var(--surface-2)] rounded animate-pulse ml-auto" /></td>}
                  {show1y && <td className="px-4 text-right"><div className="w-14 h-4 bg-[var(--surface-2)] rounded animate-pulse ml-auto" /></td>}
                  <td className="px-4 hidden md:table-cell"><div className="w-24 h-8 bg-[var(--surface-2)] rounded animate-pulse" /></td>
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={6 + (show30d ? 1 : 0) + (show1y ? 1 : 0)} className="px-4 py-10 text-center text-[var(--text-mut)]">Failed to load market data.</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6 + (show30d ? 1 : 0) + (show1y ? 1 : 0)} className="px-4 py-10 text-center text-[var(--text-mut)]">No data.</td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <AssetRow
                  key={row.id}
                  row={row}
                  index={row.id === "all" ? 0 : (page - 1) * (data?.perPage ?? 100) + idx + 1 - (page === 1 ? 1 : 0)}
                  sparkWindow={sparkWindow}
                  show30d={show30d}
                  show1y={show1y}
                  onOpenChart={openChart}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 text-sm px-1">
        <div className="text-[var(--text-mut)]">Page {page}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="icon-btn px-3 py-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={data ? !data.hasMore : false}
            className="icon-btn px-3 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

    </div>
  )
}
