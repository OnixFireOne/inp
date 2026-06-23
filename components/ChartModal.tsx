"use client"

// ChartModal — always-mounted chart panel (singleton).
//
// The TradingView widget is mounted into TvChart's own LEAF <div>,
// NOT into this host container. The host container is React-managed and
// hosts only the chart area + the close button. Pointing TradingView at the
// host would make React and TradingView fight over the same DOM nodes.
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
  // Always feed the requested symbol to the chart (CRYPTOCAP:TOTAL, BINANCE:*, etc.)
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
      setChartSymbol(req.symbol)
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

  // Host positioning: off-screen when closed, centered when open.
  // overflow-visible keeps the close button (positioned outside the frame) visible.
  // The inner chart wrapper has its own overflow-hidden + rounded-2xl for clipping.
  const hostClass = [
    "fixed z-[61]",
    visible
      ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(988px,96vw)] h-[min(720px,90vh)] opacity-100"
      : "left-[-99999px] top-0 w-[988px] h-[720px] opacity-0 pointer-events-none",
    "transition-opacity duration-200",
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
          Never removed from the DOM or reparented. overflow-visible lets the
          floating close button escape the frame. */}
      <div id={TV_HOST_ID} className={hostClass}>
        {/* Close button — floats outside the chart, top-right. */}
        <button
          onClick={close}
          aria-label="Close chart"
          className="absolute -top-3 -right-3 z-[12] w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-lg flex items-center justify-center text-[var(--text-mut)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Chart area — inner wrapper provides the visual frame (clipping + border).
            p-1 = 0.25rem padding around the iframe. */}
        <div className="w-full h-full overflow-hidden rounded-2xl border border-[var(--border)] shadow-2xl bg-[var(--surface)] p-1">
          <TvChart symbol={chartSymbol} onLoadingChange={setLoading} />
        </div>

        {/* Loading spinner overlay (covers only the chart area) */}
        {loading && visible && (
          <div className="absolute inset-1 z-[5] flex flex-col items-center justify-center gap-3 text-[var(--text-mut)] text-sm bg-[var(--surface)] rounded-2xl transition-opacity duration-200">
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
