"use client"

// AssetRow — single market row.
// Interactions:
//   • Hover the row → prefetchLinks (warm RQ cache with same queryKey as drawer).
//   • Click anywhere on the row → router.push(/asset/[id]) → intercepted modal.
//   • Click the sparkline cell → open ChartModal (stops propagation).

import { useQueryClient } from "@tanstack/react-query"
import { SparklineCell } from "./SparklineCell"
import { PriceCell } from "./PriceCell"
import { ChangeCell } from "./ChangeCell"
import { MarketCapCell } from "./MarketCapCell"
import type { MarketRow, SparkWindow } from "@/lib/types"
import { warmTradingView } from "@/components/TvChart"
import { prefetchLinks } from "@/lib/prefetch"
import { useRouter } from "next/navigation"

interface AssetRowProps {
  row: MarketRow
  index: number
  sparkWindow: SparkWindow
  onOpenChart: (row: MarketRow) => void
  /** Optional asset mapping for tv_symbol (from /api/links prefetch). */
  tvSymbolFor?: (coingeckoId: string) => string | undefined
}

export function AssetRow({
  row,
  index,
  sparkWindow,
  onOpenChart,
  tvSymbolFor,
}: AssetRowProps) {
  const router = useRouter()
  const qc = useQueryClient()
  const positive = row.change24h >= 0
  const tvSymbol =
    tvSymbolFor?.(row.id) ?? `BINANCE:${row.symbol || row.id.toUpperCase()}USDT`

  function handleOpenDrawer() {
    router.push(`/asset/${row.id}`)
  }

  function handleOpenChart(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    warmTradingView()
    onOpenChart(row)
  }

  function handleHover() {
    // Warm RQ cache with the same queryKey used by AssetDrawer → instant open.
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
        {row.rank || index}
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
      <td className="px-4 align-middle hidden md:table-cell">
        <button
          type="button"
          onClick={handleOpenChart}
          onMouseEnter={() => warmTradingView()}
          className="sparkline-btn"
          aria-label={`Open chart for ${row.symbol}`}
          title={`Chart: ${tvSymbol}`}
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