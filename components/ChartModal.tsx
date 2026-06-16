"use client"

// ChartModal — always-mounted chart panel (singleton).
//
// FIX: the TradingView widget is mounted into TvChart's own LEAF <div>,
// NOT into this host container. The host container is React-managed and holds
// the header / spinner / placeholder; pointing TradingView at it makes React
// and TradingView fight over the same DOM nodes and breaks rendering.
//
// The single TvChart instance lives inside the host. When closed, the host is
// parked off-screen with real dimensions so the iframe can warm up. When open,
// the same host is centered via CSS only — the iframe is never reparented.

import { useEffect, useRef, useState } from "react"
import {
  TvChart,
  onOpenChartRequest,
  warmTradingView,
  type ChartOpenRequest,
} from "./TvChart"

const TV_HOST_ID = "tv_chart_modal_host"
const DEFAULT_WARM_SYMBOL = "BINANCE:BTCUSDT"

interface VisibleMeta {
  name: string
  ticker: string
}

export function ChartModal() {
  const [meta, setMeta] = useState<VisibleMeta | null>(null)
  const [symbol, setSymbol] = useState<string>(DEFAULT_WARM_SYMBOL)
  // Only valid TradingView pairs are fed to the (always-mounted) chart, so the
  // warm instance is preserved even when an unsupported coin is opened.
  const [chartSymbol, setChartSymbol] = useState<string>(DEFAULT_WARM_SYMBOL)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const closeTimer = useRef<number | null>(null)

  // Subscribe to global open-chart requests
  useEffect(() => {
    const off = onOpenChartRequest((req: ChartOpenRequest) => {
      setMeta({ name: req.name, ticker: req.ticker })
      setSymbol(req.symbol)
      if (req.symbol.startsWith("BINANCE:")) setChartSymbol(req.symbol)
      setOpen(true)
    })
    return off
  }, [])

  // Drive visibility transitions
  useEffect(() => {
    if (open) {
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      setVisible(true)
    } else if (visible) {
      setVisible(false)
      closeTimer.current = window.setTimeout(() => {
        setMeta(null)
        closeTimer.current = null
      }, 180)
    }
  }, [open, visible])

  // Warm DNS/TLS + the default chart in the background
  useEffect(() => {
    warmTradingView()
  }, [])

  function close() {
    setOpen(false)
  }

  const isBinancePair = symbol.startsWith("BINANCE:")

  // Host positioning: off-screen when closed, centered when open.
  const hostClass = [
    "fixed z-[61]",
    visible
      ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(820px,100%)] h-[min(560px,90vh)] opacity-100"
      : "left-[-99999px] top-0 w-[820px] h-[560px] opacity-0 pointer-events-none",
    "transition-opacity duration-200 overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl bg-[var(--surface)]",
  ].join(" ")

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden={!visible}
        onClick={close}
        className={[
          "fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      {/* Host container — permanent home of the TradingView iframe.
          Never removed from the DOM or reparented. */}
      <div id={TV_HOST_ID} className={hostClass}>
        {/* Header bar (always above the iframe) */}
        <div className="absolute top-0 left-0 right-0 h-14 px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] z-[10]">
          <div>
            <div className="font-semibold text-base">
              {meta?.name ?? (open ? "Loading…" : "")}
            </div>
            <div className="text-xs text-[var(--text-mut)]">
              {meta ? `${meta.ticker} — TradingView` : "TradingView"}
            </div>
          </div>
          <button onClick={close} aria-label="Close chart" className="icon-btn w-9 h-9">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Chart area — its ONLY child is TvChart's leaf div.
            TvChart owns the DOM inside; React must not add siblings here. */}
        <div className="absolute top-14 left-0 right-0 bottom-0">
          <TvChart symbol={chartSymbol} onLoadingChange={setLoading} />
        </div>

        {/* Placeholder overlay for coins with no TradingView pair */}
        {!isBinancePair && (
          <div className="absolute top-14 left-0 right-0 bottom-0 z-[6] flex flex-col items-center justify-center gap-3 text-[var(--text-mut)] bg-[var(--surface)]">
            <div className="text-4xl opacity-30">📊</div>
            <div className="text-sm">No chart available for {meta?.ticker ?? "—"}</div>
            <div className="text-xs opacity-60">Pair {symbol} not found on Binance</div>
          </div>
        )}

        {/* Loading spinner overlay (covers only the chart area) */}
        {isBinancePair && loading && visible && (
          <div className="absolute top-14 left-0 right-0 bottom-0 z-[5] flex flex-col items-center justify-center gap-3 text-[var(--text-mut)] text-sm bg-[var(--surface)] transition-opacity duration-200">
            <Spinner />
            <div>TradingView loading…</div>
          </div>
        )}
      </div>

      <EscHandler onEsc={close} active={open} />
    </>
  )
}

function Spinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function EscHandler({ onEsc, active }: { onEsc: () => void; active: boolean }) {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEsc()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [active, onEsc])
  return null
}
