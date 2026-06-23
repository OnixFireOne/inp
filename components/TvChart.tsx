"use client"
import { useEffect, useId, useRef } from "react"

// =============================================================
// TvChart  (fixed)
// -------------------------------------------------------------
// IMPORTANT: tv.js is TradingView's FREE widget library. It exposes
// `TradingView.widget`, but it does NOT support Charting-Library-only
// methods: onChartReady(), activeChart(), setSymbol().
//   -> Calling them silently fails (try/catch), which is why the spinner
//      used to hang ~8s (fallback timeout) and the symbol never switched.
//
// Free-widget rules used here:
//   - The widget is mounted into TvChart's OWN leaf <div> (React renders no
//     children there) — never into a container that also holds React nodes.
//   - Switching symbol = recreate the widget (no setSymbol on the free build).
//   - "Ready" = the widget <iframe> fired its 'load' event.
//
// If you actually have the paid, self-hosted Charting Library, tell me and
// I'll give you the setSymbol() variant (instant in-place symbol switching).
// =============================================================

let tvLoading: Promise<void> | null = null
function loadTv(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  const TV = (window as any).TradingView
  if (TV && TV.widget) return Promise.resolve()
  if (!tvLoading) {
    tvLoading = new Promise<void>((res, rej) => {
      const s = document.createElement("script")
      s.src = "https://s3.tradingview.com/tv.js"
      s.async = true
      s.onload = () => res()
      s.onerror = () => rej(new Error("tv.js failed to load"))
      document.head.appendChild(s)
    })
  }
  return tvLoading
}

let preconnected = false
function ensurePreconnect() {
  if (preconnected || typeof document === "undefined") return
  preconnected = true
  for (const href of [
    "https://s3.tradingview.com",
    "https://s.tradingview.com",
    "https://data.tradingview.com",
  ]) {
    const link = document.createElement("link")
    link.rel = "preconnect"
    link.href = href
    link.crossOrigin = ""
    document.head.appendChild(link)
  }
}

/** Call once on app load: warm DNS/TLS + start loading tv.js early. */
export function warmTradingView() {
  ensurePreconnect()
  void loadTv()
}

interface TvChartProps {
  symbol: string
  /** true while (re)loading, false once the chart iframe is ready. */
  onLoadingChange?: (loading: boolean) => void
}

export function TvChart({ symbol, onLoadingChange }: TvChartProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  // useId() is stable across SSR and client, so the container id matches during
  // hydration. (A module-level counter differs between server and client and
  // causes a hydration mismatch that prevents the tree from being patched up.)
  const idRef = useRef<string>(`tv-chart-host-${useId().replace(/:/g, "")}`)
  const currentSymbol = useRef<string | null>(null)
  const pollRef = useRef<number | null>(null)
  // Keep latest callback in a ref so it is NOT an effect dependency
  // (an inline callback would otherwise rebuild the widget every render).
  const cbRef = useRef<TvChartProps["onLoadingChange"]>(onLoadingChange)
  cbRef.current = onLoadingChange

  useEffect(() => {
    ensurePreconnect()
    const mount = mountRef.current
    if (!mount) return
    let alive = true

    const clearPoll = () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    // Already showing this symbol -> instant, no reload.
    if (currentSymbol.current === symbol && mount.querySelector("iframe")) {
      cbRef.current?.(false)
      return
    }

    cbRef.current?.(true)

    loadTv()
      .then(() => {
        if (!alive) return
        const TV = (window as any).TradingView
        if (!TV || !TV.widget) {
          cbRef.current?.(false)
          return
        }

        // Free widget cannot switch symbol in place -> recreate.
        mount.innerHTML = ""
        const theme =
          document.documentElement.dataset.theme === "light" ? "light" : "dark"
        // eslint-disable-next-line no-new
        new TV.widget({
          container_id: idRef.current,
          symbol,
          interval: "D",
          theme,
          autosize: true,
          hide_side_toolbar: false,
          hide_top_toolbar: false,
          hide_legend: false,
          withdateranges: true,
          timezone: "Europe/Moscow",
          locale: "en",
          allow_symbol_change: true,
        })
        currentSymbol.current = symbol

        // Readiness = the widget iframe finished loading.
        let tries = 0
        clearPoll()
        pollRef.current = window.setInterval(() => {
          if (!alive) {
            clearPoll()
            return
          }
          tries += 1
          const iframe = mount.querySelector("iframe")
          if (iframe) {
            clearPoll()
            const done = () => {
              if (alive) cbRef.current?.(false)
            }
            iframe.addEventListener("load", done, { once: true })
            // Fallback in case 'load' fired before we attached.
            window.setTimeout(done, 1500)
          } else if (tries > 200) {
            clearPoll()
            cbRef.current?.(false)
          }
        }, 50)
      })
      .catch(() => {
        if (alive) cbRef.current?.(false)
      })

    return () => {
      alive = false
      clearPoll()
    }
  }, [symbol])

  // Leaf node owned by TradingView. React renders NO children here on purpose.
  return <div id={idRef.current} ref={mountRef} className="w-full h-full" />
}

// =============================================================
// Module-level "show this symbol" request channel. (unchanged)
// Any UI (row hover, row click, header button) can request that the
// singleton chart switches to a new symbol and the modal opens.
// =============================================================

export interface ChartOpenRequest {
  symbol: string
  name: string
  ticker: string
  /** Bumped each time the modal is (re)opened so consumers can reset spinner. */
  nonce: number
}

const CHART_EVENT = "inp:open-chart"

export function requestOpenChart(detail: Omit<ChartOpenRequest, "nonce">) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<ChartOpenRequest>(CHART_EVENT, {
      detail: { ...detail, nonce: Date.now() },
    }),
  )
}

export function onOpenChartRequest(cb: (req: ChartOpenRequest) => void): () => void {
  if (typeof window === "undefined") return () => undefined
  const handler = (e: Event) => cb((e as CustomEvent<ChartOpenRequest>).detail)
  window.addEventListener(CHART_EVENT, handler)
  return () => window.removeEventListener(CHART_EVENT, handler)
}
