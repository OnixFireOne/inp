"use client"
import { useEffect, useRef } from "react"

let tvLoading: Promise<void> | null = null
function loadTv(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if ((window as any).TradingView) return Promise.resolve()
  if (!tvLoading) {
    tvLoading = new Promise<void>(res => {
      const s = document.createElement("script")
      s.src = "https://s3.tradingview.com/tv.js"
      s.async = true
      s.onload = () => res()
      document.head.appendChild(s)
    })
  }
  return tvLoading
}

export function warmTradingView() { void loadTv() }

export function TvChart({ tvSymbol }: { tvSymbol: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const widget = useRef<any>(null)
  useEffect(() => {
    let alive = true
    loadTv().then(() => {
      if (!alive || !ref.current) return
      widget.current = new (window as any).TradingView.widget({
        container_id: ref.current.id,
        symbol: tvSymbol,
        interval: "60",
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        autosize: true,
        hide_side_toolbar: true,
        allow_symbol_change: false,
      })
    })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const w = widget.current
    if (w && w.activeChart) { try { w.activeChart().setSymbol(tvSymbol) } catch {} }
  }, [tvSymbol])
  return <div id="tv_chart" ref={ref} style={{ height: "100%", minHeight: 360 }} />
}
