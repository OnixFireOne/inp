"use client"

// AssetRow — single market row.
// Interactions:
//   • Hover the row → prefetchLinks (warm RQ cache with same queryKey as drawer).
//   • Click anywhere on the row → open /asset/[id] in the intercepted modal.
//   • Click the sparkline cell → open ChartModal (stops propagation).

import { useQueryClient } from "@tanstack/react-query"
import { SparklineCell } from "./SparklineCell"
import { PriceCell } from "./PriceCell"
import { ChangeCell } from "./ChangeCell"
import { MarketCapCell } from "./MarketCapCell"
import type { MarketRow, SparkWindow } from "@/lib/types"
import { warmTradingView } from "@/components/TvChart"
import { prefetchLinks, stashMarketRow, linksQueryKey, fetchLinksPayload } from "@/lib/prefetch"
import { useOpenAsset } from "@/lib/useOpenAsset"

interface AssetRowProps {
  row: MarketRow
  index: number
  sparkWindow: SparkWindow
  show30d?: boolean
  show1y?: boolean
  onOpenChart: (row: MarketRow, symbol: string) => void
}

export function AssetRow({
  row,
  index,
  sparkWindow,
  show30d = false,
  show1y = false,
  onOpenChart,
}: AssetRowProps) {
  const openAsset = useOpenAsset()
  const qc = useQueryClient()
  const isAll = row.id === "all"
  const positive = row.change24h >= 0

  function handleOpenDrawer() {
    openAsset(row)
  }

  async function handleOpenChart(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    warmTradingView()

    const fallback = `BINANCE:${(row.symbol || row.id).toUpperCase()}USDT`
    let symbol = isAll ? "CRYPTOCAP:TOTAL" : fallback
    if (!isAll) {
      try {
        const data = await qc.fetchQuery({
          queryKey: linksQueryKey(row.id),
          queryFn: ({ signal }) => fetchLinksPayload(row.id, signal),
          staleTime: 60_000,
        })
        symbol = data?.asset?.tv_symbol?.trim() || fallback
      } catch {
        symbol = fallback
      }
    }
    onOpenChart(row, symbol)
  }

  function handleHover() {
    // Warm RQ cache with the same queryKey used by AssetDrawer → instant open.
    stashMarketRow(qc, row)
    prefetchLinks(qc, row.id)
    warmTradingView()
  }

  return (
    <tr
      className="asset-row row-h border-b border-[var(--border)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
      onMouseEnter={handleHover}
      onClick={handleOpenDrawer}
    >
      <td className="px-4 text-[var(--text-mut)] tabular-nums text-sm align-middle">
        {isAll ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Pinned"
          >
            <path d="M12 17v5" />
            <path d="M9 10.76V6a3 3 0 0 1 6 0v4.76a2 2 0 0 0 .59 1.41L18 14H6l2.41-1.83A2 2 0 0 0 9 10.76z" />
          </svg>
        ) : (
          row.rank ?? index
        )}
      </td>
      <td className="px-4 align-middle">
        <div className="group flex items-center gap-3 min-w-0">
          {row.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.image}
              alt=""
              width={28}
              height={28}
              className="coin w-7 h-7 rounded-full bg-[var(--surface-2)] transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="coin w-7 h-7 rounded-full bg-[var(--surface-2)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="asset-name text-sm truncate max-w-[16ch] sm:max-w-[24ch]">
              {row.name}
              <span className="asset-chevron" aria-hidden>›</span>
            </div>
            <div className="text-[12px] text-[var(--text-mut)] uppercase tracking-wide">{row.symbol}</div>
          </div>
        </div>
      </td>
      <td className="px-4 text-right align-middle">
        <PriceCell price={row.price} />
      </td>
      <td className="px-4 text-right align-middle hidden sm:table-cell">
        <MarketCapCell value={row.marketCap} />
      </td>
      <td className="px-4 text-right align-middle">
        <ChangeCell value={row.change24h} />
      </td>
      {show30d && (
        <td className="px-4 text-right align-middle tabular-nums">
          <ChangeCell value={row.change30d} />
        </td>
      )}
      {show1y && (
        <td className="px-4 text-right align-middle tabular-nums">
          <ChangeCell value={row.change1y} />
        </td>
      )}
      <td className="px-4 align-middle hidden md:table-cell">
        <button
          type="button"
          onClick={handleOpenChart}
          onMouseEnter={() => warmTradingView()}
          className="sparkline-btn"
          aria-label={`Open chart for ${row.symbol}`}
          title={`Chart: ${row.symbol}`}
        >
          <SparklineCell
            coingeckoId={row.id}
            defaultData={row.sparkline}
            positive={positive}
            window={sparkWindow}
          />
          <span className="sparkline-corner" aria-hidden>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
            </svg>
          </span>
        </button>
      </td>
    </tr>
  )
}
