"use client"

// HotCoinsBeeswarm — live beeswarm visualization of the top coins.
//
//   • Data source: the SAME `MarketRow[]` that AssetTable consumes (from
//     /api/markets via the `useMarkets` hook), so the row/sticker/cap/%24h
//     fields are guaranteed in sync with the table below it.
//
//   • Engine: rAF loop with spring physics + collision resolution + zoom/pan
//     + hover + click-to-open (router.push(/asset/[id]) → intercepted modal).
//
//   • All canvas / window / devicePixelRatio access is inside useEffect —
//     no SSR-time access. Cleanup cancels rAF and detaches every listener.
//
//   • Tailwind controls (no inline CSS). Sliders live in useState.

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import type { MarketRow } from "@/lib/types"
import { stashMarketRow, prefetchLinks } from "@/lib/prefetch"

// -------------------------------------------------------------
// Persisted user settings (localStorage)
// -------------------------------------------------------------
const PREFS_KEY = "hcb_prefs_v2"
// Ширина боковой полосы оси процентов при повороте (orient==="v").
const AXIS_W = 46
type Prefs = Partial<{
  mode: string
  sizeMult: number
  unit: number
  topN: number
  showAll: boolean
  scaleType: string
  shape: string
  gravity: number
  flatten: number
  density: number
  orient: string
  squeeze: number
  pinAll: boolean
  startView: string
}>
function readPrefs(): Prefs {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}") as Prefs
  } catch {
    return {}
  }
}

// -------------------------------------------------------------
// Public props
// -------------------------------------------------------------
interface HotCoinsBeeswarmProps {
  coins: MarketRow[]
  /** Optional height for the stage. Defaults to 560px. */
  height?: number
}

// -------------------------------------------------------------
// Local types for the engine
// -------------------------------------------------------------
type Mode = "both" | "gainers" | "losers"

interface Coin {
  id: string
  symbol: string
  name: string
  marketCap: number
  pct: number
  stable: boolean
}

interface Node {
  c: Coin
  idx: number       // global index into the source coin list
  rank: number      // rank by market cap in the filtered set
  r: number         // radius (px)
  x: number
  y: number
  vx: number
  vy: number
  tx: number        // target x
  ty: number        // target y
  ty0: number       // un-flattened target y
  showLabel: boolean // whether to draw floating label (symbol above + % below)
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
const GREEN = [22, 199, 132] as const
const RED = [234, 57, 67] as const
const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Arial,sans-serif'

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}
function rgba(c: readonly [number, number, number], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}
function fmtCap(c: number): string {
  if (c >= 1e12) return "$" + (c / 1e12).toFixed(2) + "T"
  if (c >= 1e9) return "$" + (c / 1e9).toFixed(1) + "B"
  if (c >= 1e6) return "$" + (c / 1e6).toFixed(0) + "M"
  return "$" + (c / 1e3).toFixed(0) + "K"
}
function fmtPct(p: number) {
  return (p >= 0 ? "+" : "") + p.toFixed(2) + "%"
}

// -------------------------------------------------------------
// Component
// -------------------------------------------------------------
export function HotCoinsBeeswarm({ coins, height = 560 }: HotCoinsBeeswarmProps) {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const axisRef = useRef<HTMLCanvasElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  // Выбранная монета (только ref — draw() читает напрямую, без ре-рендера).
  const selectedIdRef = useRef<string | null>(null)

  // -------------------- Slider state -----------------------------
  const prefs0 = useMemo(() => readPrefs(), [])
  const [mode, setMode] = useState<Mode>(() => (prefs0.mode as Mode) ?? "both")
  const [sizeMult, setSizeMult] = useState(() => prefs0.sizeMult ?? 1)
  const [unit, setUnit] = useState(() => prefs0.unit ?? 9)        // px/%
  const ALLOWED_TOPN = [100, 200, 300, 400] as const
  const [topN, setTopN] = useState(() =>
    (ALLOWED_TOPN as readonly number[]).includes(prefs0.topN as number) ? (prefs0.topN as number) : 200,
  )
  const [showAll, setShowAll] = useState(() => prefs0.showAll ?? false)
  const [scaleType, setScaleType] = useState<"linear" | "log">(() => (prefs0.scaleType as "linear" | "log") ?? "linear")
  const [shape, setShape] = useState<"circle" | "hex">(() => (prefs0.shape as "circle" | "hex") ?? "hex")
  const [gravity, setGravity] = useState(() => prefs0.gravity ?? 0.02)
  const [flatten, setFlatten] = useState(() => prefs0.flatten ?? 0)  // 0..1
  const [density, setDensity] = useState(() => prefs0.density ?? 1.4)
  const [squeeze, setSqueeze] = useState(() => prefs0.squeeze ?? 0) // 0..1 — сжатие пустых промежутков по краям
  const [orient, setOrient] = useState<"h" | "v">(() => (prefs0.orient as "h" | "v") ?? "h")
  const [pinAll, setPinAll] = useState(() => prefs0.pinAll ?? true)
  const [startView, setStartView] = useState<"equator" | "auto">(() => (prefs0.startView as "equator" | "auto") ?? "auto")
  const [panelOpen, setPanelOpen] = useState(false) // панель настроек свёрнута по умолчанию
  // Запоминаем настройки в localStorage и восстанавливаем при загрузке.
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ mode, sizeMult, unit, topN, showAll, scaleType, shape, gravity, flatten, density, squeeze, orient, pinAll, startView }),
      )
    } catch {}
  }, [mode, sizeMult, unit, topN, showAll, scaleType, shape, gravity, flatten, density, squeeze, orient, pinAll, startView])

  // ---------------- Data layer: wider sample + on-demand paging ----------
  // The page hands us only the SSR'd page 1 (~100 rows, incl. the synthetic
  // "all" aggregate row). We seed from it (dropping "all"), then lazily fetch
  // more pages (/api/markets?page=N, 100/page) as the "Монет" slider asks for
  // a wider sample — up to MAX_PAGES * 100 coins.
  const PER_PAGE = 100
  const MAX_PAGES = 5 // ceiling = 500 coins

  function mergeRows(...lists: MarketRow[][]): MarketRow[] {
    const seen = new Set<string>()
    const out: MarketRow[] = []
    for (const list of lists) {
      for (const r of list) {
        if (r.id === "all") continue // never plot the aggregate row
        if (seen.has(r.id)) continue
        seen.add(r.id)
        out.push(r)
      }
    }
    return out
  }

  const [rows, setRows] = useState<MarketRow[]>(() => mergeRows(coins))
  const loadedPagesRef = useRef(coins.length > 0 ? 1 : 0)
  const loadingRef = useRef(false)

  // Re-seed if the parent re-supplies page 1 (e.g. SSR revalidate). Keeps any
  // deeper pages we already fetched.
  useEffect(() => {
    setRows((prev) => mergeRows(coins, prev))
    if (loadedPagesRef.current < 1 && coins.length > 0) loadedPagesRef.current = 1
  }, [coins])

  // React to the "Монет" slider (and the initial default): make sure enough
  // pages are loaded to cover the requested coin count, fetching on demand.
  useEffect(() => {
    const wantPages = clamp(Math.ceil(topN / PER_PAGE), 1, MAX_PAGES)
    if (wantPages <= loadedPagesRef.current || loadingRef.current) return
    let cancelled = false
    loadingRef.current = true
    ;(async () => {
      try {
        const collected: MarketRow[] = []
        for (let p = loadedPagesRef.current + 1; p <= wantPages; p++) {
          const res = await fetch(`/api/markets?page=${p}`)
          if (!res.ok) break
          const json = (await res.json()) as { rows?: MarketRow[] }
          collected.push(...(json.rows ?? []))
          loadedPagesRef.current = p
        }
        if (!cancelled && collected.length > 0) {
          setRows((prev) => mergeRows(prev, collected))
        }
      } finally {
        loadingRef.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [topN])

  // Map MarketRow → Coin. Stables / invalid rows are dropped here (mirrors the
  // prototype's baseList()); the "all" row is already gone via mergeRows.
  const sourceCoins: Coin[] = useMemo(() => {
    const out: Coin[] = []
    for (const r of rows) {
      if (r.stable) continue
      if (!Number.isFinite(r.change24h)) continue
      if (r.marketCap == null || !Number.isFinite(r.marketCap)) continue
      out.push({
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        marketCap: r.marketCap,
        pct: r.change24h,
        stable: !!r.stable,
      })
    }
    return out
  }, [rows])

  // The engine effect runs once ([]) and reads the coin list through this ref
  // so lazily-loaded pages appear without tearing down the rAF loop.
  const sourceCoinsRef = useRef(sourceCoins)
  sourceCoinsRef.current = sourceCoins

  // Stats chips (memoized)
  const stats = useMemo(() => {
    if (sourceCoins.length === 0) return null
    const sorted = sourceCoins.slice().sort((a, b) => b.pct - a.pct)
    return {
      top: sorted[0],
      bottom: sorted[sorted.length - 1],
      count: sourceCoins.length,
    }
  }, [sourceCoins])

  // -------------------- Engine refs ------------------------------
  // All mutable engine state lives inside refs so the rAF loop never
  // re-renders React. State setters are wired into the same refs via
  // ref-like "params" pattern (see currentParams below).
  const stateRef = useRef({
    zoom: 1,
    panX: 0,
    panY: 0,
    hoverIdx: -1,
    hoverNode: null as Node | null,
    labelAlpha: 0,
    labelTarget: 1,
    raf: 0 as number,
    nodes: [] as Node[],
    worldMinX: 0,
    worldMaxX: 0,
    worldMinY: 0,
    worldMaxY: 0,
    cssW: 0,
    cssH: 0,
    orient: "h" as "h" | "v",
    initialized: false,
    didDrag: false,
    isDragging: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    // Edge pins (screen-space indicators for off-screen nodes)
    edgePins: [] as Array<{ x: number; y: number; r: number; node: Node }>,
    // Default-view anchor (saved by fitView)
    fitZoom: 1,
    fitPanX: 0,
    fitPanY: 0,
  })

  // Mirror latest slider values into a ref the loop reads.
  const paramsRef = useRef({
    mode,
    sizeMult,
    unit,
    topN,
    showAll,
    scaleType,
    shape,
    gravity,
    flatten,
    density,
    squeeze,
    orient,
    pinAll,
    startView,
  })
  useEffect(() => {
    paramsRef.current = {
      mode,
      sizeMult,
      unit,
      topN,
      showAll,
      scaleType,
      shape,
      gravity,
      flatten,
      density,
      squeeze,
      orient,
      pinAll,
      startView,
    }
    stateRef.current.orient = orient
  }, [
    mode,
    sizeMult,
    unit,
    topN,
    showAll,
    scaleType,
    shape,
    gravity,
    flatten,
    density,
    squeeze,
    orient,
    pinAll,
    startView,
  ])

  // Bumped on each "structural" change so the loop re-runs computeNodes
  // and re-fits the view. The watchInterval inside useEffect reads this
  // value and recomputes the node graph.
  const layoutVersionRef = useRef(0)
  // Пользователь вручную панорамировал/зумил — отключает авто-подстройку вида под данные.
  const userTouchedRef = useRef(false)
  // Лейбл текущего масштаба (обновляется прямо в draw без ре-рендера).
  const zoomLabelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Any change to sliders/state — let the engine notice via the watcher.
    layoutVersionRef.current++
  }, [
    mode,
    sizeMult,
    unit,
    topN,
    showAll,
    scaleType,
    shape,
    gravity,
    flatten,
    density,
    squeeze,
    orient,
    pinAll,
    startView,
  ])

  // Сброс выделения монеты при ЗАКРЫТИИ drawer (карточки монеты).
  // Drawer открывается через router.push("/asset/[id]") и закрывается через
  // window.history.back() в app/@modal/(.)asset/[id]/page.tsx — поэтому
  // pathname перестаёт начинаться с "/asset/". Других причин для сброса нет:
  // не сбрасываем на смене режима / topN / зума / fit.
  useEffect(() => {
    const inDrawer = !!pathname?.startsWith("/asset/")
    if (!inDrawer) selectedIdRef.current = null
  }, [pathname])
  // =============================================================
  // Engine
  // =============================================================
  useEffect(() => {
    if (typeof window === "undefined") return
    const container = containerRef.current
    const cv = canvasRef.current
    const axisCv = axisRef.current
    const tipEl = tipRef.current
    if (!container || !cv || !axisCv || !tipEl) return

    const ctx = cv.getContext("2d")
    const axc = axisCv.getContext("2d")
    if (!ctx || !axc) return

    const s = stateRef.current

    // ---- view helpers (closures over state) -------------------
    function sxWorld(p: number, unitPx: number, scale: "linear" | "log") {
      if (scale === "log") return Math.sign(p) * Math.log10(1 + Math.abs(p)) * unitPx * 7
      // «Сжать пустоты»: ядро ±K% линейное, выбросы за K сжимаются — меньше пустоты по краям.
      const sq = paramsRef.current.squeeze || 0
      const a = Math.abs(p)
      const K = 20
      if (sq > 0 && a > K) {
        const f = 1 - 0.85 * sq
        return Math.sign(p) * (K + (a - K) * f) * unitPx
      }
      return p * unitPx
    }
    function worldToScreenX(v: number) {
      const p = paramsRef.current
      return s.panX + sxWorld(v, p.unit, p.scaleType) * s.zoom
    }
    // Разворот для orient==="v": раскладка «капы» как при повороте по часовой,
    // но с отражением по вертикали — рост (x>0) уходит вверх, падение вниз: (wx,wy) -> (-wy, -wx).
    function rot(wx: number, wy: number) {
      return paramsRef.current.orient === "v" ? { x: -wy, y: -wx } : { x: wx, y: wy }
    }
    // Экранная координата оси % для значения тика (горизонталь или вертикаль).
    function axisScreen(v: number) {
      const p = paramsRef.current
      const d = sxWorld(v, p.unit, p.scaleType) * s.zoom
      return p.orient === "v" ? s.panY - d : s.panX + d
    }
    function getTicks(): number[] {
      const p = paramsRef.current
      const span = p.orient === "v" ? s.cssH : s.cssW
      const pan = p.orient === "v" ? s.panY : s.panX
      if (p.scaleType === "log") {
        return [-200, -100, -50, -20, -10, -5, -2, -1, 0, 1, 2, 5, 10, 20, 50, 100, 200]
      }
      const uz = p.unit * s.zoom
      const e0 = p.orient === "v" ? (pan - 0) / uz : (0 - pan) / uz
      const e1 = p.orient === "v" ? (pan - span) / uz : (span - pan) / uz
      const vMin = Math.min(e0, e1)
      const vMax = Math.max(e0, e1)
      const steps = [1, 2, 5, 10, 25, 50, 100, 250]
      let step = steps[steps.length - 1]
      for (const st of steps) {
        if (st * p.unit * s.zoom >= 58) {
          step = st
          break
        }
      }
      const lo = Math.ceil(vMin / step) * step
      const hi = Math.floor(vMax / step) * step
      const out: number[] = []
      for (let v = lo; v <= hi + 0.001; v += step) out.push(Math.round(v))
      return out
    }

    function layoutTargets(
      st: typeof s,
      flattenVal: number,
      densityVal: number,
      unitPx: number,
      scale: "linear" | "log",
      sizeM: number,
    ) {
      const N = Math.max(st.nodes.length, 1)
      const mid = (N - 1) / 2
      const gap = densityVal
      // Need node sizes for placement — recompute from current params:
      const maxSC = st.nodes.reduce(
        (m, n) => Math.max(m, Math.sqrt(n.c.marketCap)),
        1,
      )
      for (const n of st.nodes) {
        n.r = (3 + Math.sqrt(n.c.marketCap) / maxSC * 18) * sizeM
        n.tx = sxWorld(n.c.pct, unitPx, scale)
      }
      const order = st.nodes.slice().sort((a, b) => Math.abs(a.rank - mid) - Math.abs(b.rank - mid))
      const placed: Node[] = []
      for (const nd of order) {
        const up = nd.rank <= mid
        const cand: number[] = [0]
        for (let i = 1; i <= 500; i++) cand.push(up ? -i * 2 : i * 2)
        for (let i = 1; i <= 500; i++) cand.push(up ? i * 2 : -i * 2)
        let done = false
        for (const off of cand) {
          let ok = true
          for (const p of placed) {
            if (Math.abs(p.tx - nd.tx) > p.r + nd.r + gap) continue
            const dx = p.tx - nd.tx
            const dy = p.ty0 - off
            const rr = p.r + nd.r + gap
            if (dx * dx + dy * dy < rr * rr) {
              ok = false
              break
            }
          }
          if (ok) {
            nd.ty0 = off
            done = true
            break
          }
        }
        if (!done) nd.ty0 = 0
        placed.push(nd)
      }
      for (const n of st.nodes) n.ty = n.ty0 * (1 - flattenVal)
      st.worldMinX = Math.min.apply(
        null,
        st.nodes.map((n) => n.tx - n.r).concat([-unitPx * 2]),
      )
      st.worldMaxX = Math.max.apply(
        null,
        st.nodes.map((n) => n.tx + n.r).concat([unitPx * 2]),
      )
      st.worldMinY = Math.min.apply(null, st.nodes.map((n) => n.ty - n.r).concat([0]))
      st.worldMaxY = Math.max.apply(null, st.nodes.map((n) => n.ty + n.r).concat([0]))
    }

    function computeNodes() {
      const p = paramsRef.current
      let set = sourceCoinsRef.current.slice()
      if (p.mode === "gainers") set = set.filter((c) => c.pct > 0)
      else if (p.mode === "losers") set = set.filter((c) => c.pct < 0)
      set.sort((a, b) => b.marketCap - a.marketCap)
      set = set.slice(0, p.topN)

      const prev: Record<string, { x: number; y: number; vx: number; vy: number }> = {}
      for (const n of s.nodes) prev[n.c.id] = { x: n.x, y: n.y, vx: n.vx, vy: n.vy }

      const nodes: Node[] = set.map((c, i) => {
        const pr = prev[c.id]
        return {
          c,
          idx: sourceCoinsRef.current.indexOf(c),
          rank: i,
          pct: c.pct,
          r: 0,
          x: pr?.x ?? 0,
          y: pr?.y ?? 0,
          vx: pr?.vx ?? 0,
          vy: pr?.vy ?? 0,
          tx: 0,
          ty: 0,
          ty0: 0,
          showLabel: false,
        }
      })
      s.nodes = nodes
      // Pick up to 3 extreme coins for floating labels, ensuring ≥10pp separation.
      const SEP = 7
      const MAX_LABELS = 3
      for (const n of s.nodes) n.showLabel = false
      const cand = s.nodes.slice().sort(
        (a, b) => Math.abs(b.c.pct) - Math.abs(a.c.pct),
      )
      const taken: number[] = []
      for (const n of cand) {
        if (taken.length >= MAX_LABELS) break
        if (taken.some((p) => Math.abs(p - n.c.pct) < SEP)) continue
        n.showLabel = true
        taken.push(n.c.pct)
      }
      layoutTargets(s, p.flatten, p.density, p.unit, p.scaleType, p.sizeMult)
      for (const n of s.nodes) {
        const pr = prev[n.c.id]
        if (pr) {
          n.x = pr.x
          n.y = pr.y
          n.vx = pr.vx
          n.vy = pr.vy
        } else {
          n.x = n.tx
          n.y = n.ty
          n.vx = 0
          n.vy = 0
        }
      }
    }

    function physicsStep() {
      const p = paramsRef.current
      const k = p.gravity
      const damp = 0.8
      for (const n of s.nodes) {
        n.vx += (n.tx - n.x) * k
        n.vx *= damp
        n.x += n.vx
        n.vy += (n.ty - n.y) * k
        n.vy *= damp
        n.y += n.vy
      }
      resolveCollisions(p.shape, p.density)
    }

    function resolveCollisions(shapeMode: "circle" | "hex", densityVal: number) {
      if (s.nodes.length < 2) return
      const hexF = shapeMode === "hex" ? 0.9 : 1
      let maxR = 0
      for (const n of s.nodes) if (n.r > maxR) maxR = n.r
      const ord = s.nodes.slice().sort((a, b) => a.x - b.x)
      const reach = maxR * 2 * hexF + densityVal
      for (let pass = 0; pass < 10; pass++) {
        let moved = false
        for (let i = 0; i < ord.length; i++) {
          const a = ord[i]
          for (let j = i + 1; j < ord.length; j++) {
            const b = ord[j]
            const dx = b.x - a.x
            if (dx > reach) break
            const minD = (a.r + b.r) * hexF + densityVal
            if (dx >= minD) continue
            const need = Math.sqrt(minD * minD - dx * dx)
            const overlap = need - Math.abs(b.y - a.y)
            if (overlap > 0.01) {
              const hi = a.rank <= b.rank ? a : b
              const lo = a.rank <= b.rank ? b : a
              hi.y -= overlap / 2
              lo.y += overlap / 2
              hi.vy *= 0.5
              lo.vy *= 0.5
              moved = true
            }
          }
        }
        if (!moved) break
      }
    }

    function pathShape(x: number, y: number, r: number, shapeMode: "circle" | "hex") {
      if (shapeMode === "hex") {
        ctx!.beginPath()
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k
          const px = x + r * Math.cos(a)
          const py = y + r * Math.sin(a)
          if (k) ctx!.lineTo(px, py)
          else ctx!.moveTo(px, py)
        }
        ctx!.closePath()
      } else {
        ctx!.beginPath()
        ctx!.arc(x, y, r, 0, Math.PI * 2)
      }
    }

    function drawGrid(W: number, H: number) {
      const vMode = paramsRef.current.orient === "v"
      const ticks = getTicks()
      for (const v of ticks) {
        const q = axisScreen(v)
        if (vMode ? q < -2 || q > H + 2 : q < -2 || q > W + 2) continue
        const strong = v === 0
        ctx!.strokeStyle = strong ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.05)"
        ctx!.lineWidth = strong ? 1.5 : 1
        ctx!.beginPath()
        if (vMode) {
          ctx!.moveTo(0, q)
          ctx!.lineTo(W, q)
        } else {
          ctx!.moveTo(q, 0)
          ctx!.lineTo(q, H)
        }
        ctx!.stroke()
      }
    }

    function drawAxisStrip() {
      const p = paramsRef.current
      const W = s.cssW
      const H = s.cssH
      const dpr = window.devicePixelRatio || 1
      axc!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const ticks = getTicks()
      if (p.orient === "v") {
        // Вертикальная ось — полоса процентов уходит влево, на боковой холст.
        axc!.clearRect(0, 0, AXIS_W, H)
        axc!.textAlign = "right"
        axc!.textBaseline = "middle"
        for (const v of ticks) {
          const Y = axisScreen(v)
          if (Y < 8 || Y > H - 4) continue
          const strong = v === 0
          axc!.strokeStyle = strong ? "#e6e9ef" : "#566076"
          axc!.lineWidth = 1
          axc!.beginPath()
          axc!.moveTo(AXIS_W, Y)
          axc!.lineTo(AXIS_W - 7, Y)
          axc!.stroke()
          axc!.fillStyle = strong ? "#e6e9ef" : "rgba(255,255,255,.5)"
          axc!.font = (strong ? "700 " : "500 ") + "11px " + FONT
          axc!.fillText((v > 0 ? "+" : "") + v + "%", AXIS_W - 10, Y)
        }
        return
      }
      axc!.clearRect(0, 0, W, 30)
      axc!.textAlign = "center"
      axc!.textBaseline = "alphabetic"
      for (const v of ticks) {
        const X = axisScreen(v)
        if (X < -2 || X > W + 2) continue
        const strong = v === 0
        axc!.strokeStyle = strong ? "#e6e9ef" : "#566076"
        axc!.lineWidth = 1
        axc!.beginPath()
        axc!.moveTo(X, 0)
        axc!.lineTo(X, 7)
        axc!.stroke()
        axc!.fillStyle = strong ? "#e6e9ef" : "rgba(255,255,255,.5)"
        axc!.font = (strong ? "700 " : "500 ") + "11px " + FONT
        axc!.fillText((v > 0 ? "+" : "") + v + "%", X, 21)
      }
    }

    const resizeIfNeeded = () => {
      const cont = container!
      const dpr = window.devicePixelRatio || 1
      const rect = cont.getBoundingClientRect()
      const cssW = Math.max(1, Math.round(rect.width))
      const cssH = Math.max(1, Math.round(rect.height))
      s.cssW = cssW
      s.cssH = cssH
      const cw = Math.round(cssW * dpr)
      const ch = Math.round(cssH * dpr)
      if (cv!.width !== cw) cv!.width = cw
      if (cv!.height !== ch) cv!.height = ch
      const vMode = s.orient === "v"
      const aw = Math.round((vMode ? AXIS_W : cssW) * dpr)
      const ah = Math.round((vMode ? cssH : 30) * dpr)
      if (axisCv!.width !== aw) axisCv!.width = aw
      if (axisCv!.height !== ah) axisCv!.height = ah
    }

    function draw() {
      resizeIfNeeded()
      const p = paramsRef.current
      const dpr = window.devicePixelRatio || 1
      const W = s.cssW
      const H = s.cssH
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, W, H)
      // Фон рисуем на канвасе, чтобы «фон процентов» поворачивался вместе с графиком.
      ctx!.fillStyle = "#0e1116"
      ctx!.fillRect(0, 0, W, H)
      const vign = ctx!.createRadialGradient(W / 2, -H * 0.12, 0, W / 2, -H * 0.12, Math.max(W, H) * 1.15)
      vign.addColorStop(0, "#121a2c")
      vign.addColorStop(0.72, "#0e1116")
      ctx!.fillStyle = vign
      ctx!.fillRect(0, 0, W, H)
      const tint =
        p.orient === "v"
          ? ctx!.createLinearGradient(0, H, 0, 0)
          : ctx!.createLinearGradient(0, 0, W, 0)
      tint.addColorStop(0, "rgba(234,57,67,.16)")
      tint.addColorStop(0.4, "rgba(234,57,67,0)")
      tint.addColorStop(0.6, "rgba(22,199,132,0)")
      tint.addColorStop(1, "rgba(22,199,132,.16)")
      ctx!.fillStyle = tint
      ctx!.fillRect(0, 0, W, H)
      drawGrid(W, H)
      ctx!.save()
      ctx!.translate(s.panX, s.panY)
      ctx!.scale(s.zoom, s.zoom)
      for (const n of s.nodes) {
        const pos = n.c.pct >= 0
        const col = pos ? GREEN : RED
        const inten = clamp(Math.abs(n.c.pct) / 14, 0, 1)
        const R = rot(n.x, n.y)
        pathShape(R.x, R.y, n.r, p.shape)
        ctx!.fillStyle = rgba(col, 0.3 + inten * 0.5)
        ctx!.fill()
        ctx!.lineWidth = 1
        ctx!.strokeStyle = rgba(col, 0.9)
        ctx!.stroke()
        if (n.idx === s.hoverIdx) {
          ctx!.fillStyle = "rgba(255,255,255,.20)"
          ctx!.fill()
        }
      }
      // Выделение выбранной монеты — только обводка, без затенения остальных.
      // Рисуем после основного цикла нод, чтобы кольцо не перекрывалось соседями.
      const selId = selectedIdRef.current
      if (selId) {
        const sel = s.nodes.find((n) => n.c.id === selId)
        if (sel) {
          const R = rot(sel.x, sel.y)
          pathShape(R.x, R.y, sel.r, p.shape)
          ctx!.shadowColor = "rgba(255,255,255,.5)"
          ctx!.shadowBlur = 10
          ctx!.strokeStyle = "rgba(255,255,255,.95)"
          ctx!.lineWidth = 2.5
          ctx!.stroke()
          ctx!.shadowBlur = 0
        }
      }
      ctx!.globalAlpha = s.labelAlpha
      ctx!.textAlign = "center"
      ctx!.textBaseline = "alphabetic"
      for (const n of s.nodes) {
        const pos = n.c.pct >= 0
        const pc = pos ? "#16c784" : "#ea3943"
        const isSel = selId !== null && n.c.id === selId
        const dist = n.showLabel || isSel
        const R = rot(n.x, n.y)
        if (dist) {
          ctx!.fillStyle = "#fff"
          ctx!.font = "700 9.5px " + FONT
          ctx!.fillText(n.c.symbol, R.x, R.y - n.r - 4)
          ctx!.fillStyle = pc
          ctx!.font = "700 9px " + FONT
          ctx!.fillText(fmtPct(n.c.pct), R.x, R.y + n.r + 10)
        } else if (n.r >= 11) {
          ctx!.fillStyle = "#fff"
          ctx!.font = "700 9px " + FONT
          ctx!.fillText(n.c.symbol, R.x, R.y + 3)
          if (p.showAll) {
            ctx!.fillStyle = pc
            ctx!.font = "700 8.5px " + FONT
            ctx!.fillText(fmtPct(n.c.pct), R.x, R.y + n.r + 9)
          }
        } else if (p.showAll) {
          ctx!.fillStyle = pc
          ctx!.font = "700 8.5px " + FONT
          ctx!.fillText(fmtPct(n.c.pct), R.x, R.y + n.r + 9)
        }
      }
      ctx!.globalAlpha = 1
      ctx!.restore()
      drawEdgePins()
      drawAxisStrip()
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = Math.round((s.zoom / (s.fitZoom || s.zoom)) * 100) + "%"
      }
    }

    function loop() {
      physicsStep()
      if (s.labelAlpha < s.labelTarget) s.labelAlpha = Math.min(s.labelTarget, s.labelAlpha + 0.04)
      else if (s.labelAlpha > s.labelTarget) s.labelAlpha = Math.max(s.labelTarget, s.labelAlpha - 0.08)
      draw()
      s.raf = requestAnimationFrame(loop)
    }

    // ---- zoom helpers ----------------------------------------
    function fitView(force = false) {
      const p = paramsRef.current
      const vMode = p.orient === "v"
      const W = s.cssW
      const H = s.cssH
      const pad = 46
      const stripBottom = vMode ? 0 : 30
      const stripLeft = vMode ? AXIS_W : 0
      // БАЗА: красиво масштабируем ВСЮ высоту роя и центрируем по СЕРЕДИНЕ этой высоты
      // (а не по нулю/экватору) — чтобы не резало ни верх, ни низ.
      const extentY = Math.max(s.worldMaxY - s.worldMinY, 1)
      const crossSize = vMode ? (W - stripLeft - pad * 2) : (H - stripBottom - pad * 2)
      let zoom = clamp(crossSize / extentY, 0.12, 4)
      const cx = stripLeft + (W - stripLeft) / 2
      const cy = (H - stripBottom) / 2
      const midY = (s.worldMinY + s.worldMaxY) / 2
      const Rm = rot(0, midY)
      let panX = cx - Rm.x * zoom
      let panY = cy - Rm.y * zoom
      // РЕЖИМ «Экватор+BTC»: поверх базового фита ПРОСТО ДОБАВЛЯЕМ зум к BTC
      // и центрируем СЕРЕДИНУ отрезка «экватор (0) ↔ BTC». В режиме «Авто» — чистый fitView.
      if (p.startView === "equator") {
        const btc =
          s.nodes.find((n) => n.c.symbol?.toUpperCase() === "BTC") ??
          s.nodes.find((n) => n.rank === 0)
        if (btc) {
          // Авто-масштаб: подбираем зум так, чтобы BTC (с радиусом) НЕ резался,
          // а экватор оставался виден. Половина нужного поперечного размаха =
          // расстояние от середины отрезка до дальнего края BTC (|ty|/2 + r). Высота считается сама по данным.
          const halfSpan = Math.abs(btc.ty) / 2 + btc.r
          zoom = clamp((crossSize / 2) / (halfSpan * 1.12), 0.12, 9)
          const Rb = rot(0, btc.ty / 2)
          panX = cx - Rb.x * zoom
          panY = cy - Rb.y * zoom
        }
      }
      s.zoom = zoom
      s.panX = panX
      s.panY = panY
      // эталон «дефолтного» кадра для определения выбросов
      s.fitZoom = s.zoom
      s.fitPanX = s.panX
      s.fitPanY = s.panY
      if (force) {
        s.labelAlpha = 0
        s.labelTarget = 1
      }
    }

    function drawEdgePins() {
      const p = paramsRef.current
      const vMode = p.orient === "v"
      const stripBottom = vMode ? 0 : 30
      const stripLeft = vMode ? AXIS_W : 0
      const m = 12
      const minX = stripLeft + m
      const maxX = s.cssW - m
      const minY = m
      const maxY = s.cssH - stripBottom - m
      s.edgePins = []
      const buckets: Record<string, Node[]> = {}
      for (const n of s.nodes) {
        const R = rot(n.x, n.y)
        // 1) текущий кадр — за краем ли сейчас?
        const sx = s.panX + R.x * s.zoom
        const sy = s.panY + R.y * s.zoom
        const offCur = sx < minX || sx > maxX || sy < minY || sy > maxY
        if (!offCur) continue
        if (!p.pinAll) {
          // Режим «только выбросы»: пинить лишь тех, кто не влез бы и в дефолтный кадр.
          const dx = s.fitPanX + R.x * s.fitZoom
          const dy = s.fitPanY + R.y * s.fitZoom
          const offDef = dx < minX || dx > maxX || dy < minY || dy > maxY
          if (!offDef) continue
        }
        // Выбор края — по ТЕКУЩЕМУ выходу за кадр: при зуме верхние уходят на верх (T), нижние — на низ (B), а не сваливаются по дефолтному кадру.
        const overL = minX - sx
        const overR = sx - maxX
        const overT = minY - sy
        const overB = sy - maxY
        const mo = Math.max(overL, overR, overT, overB)
        const edge = mo === overL ? "L" : mo === overR ? "R" : mo === overT ? "T" : "B"
        // Раздельные стопки для зелёных и красных на одном крае (ключ = край + знак).
        const sign = n.c.pct >= 0 ? "G" : "R"
        const key = edge + ":" + sign
        ;(buckets[key] ||= []).push(n)
      }
      ctx!.textAlign = "center"
      ctx!.textBaseline = "middle"
      for (const key in buckets) {
        const edge = key[0]
        const arr = buckets[key].sort(
          (a, b) => Math.abs(b.c.pct) - Math.abs(a.c.pct),
        )
        const rep = arr[0]
        const R = rot(rep.x, rep.y)
        const sx = clamp(s.panX + R.x * s.zoom, minX, maxX)
        const sy = clamp(s.panY + R.y * s.zoom, minY, maxY)
        const col = rep.c.pct >= 0 ? GREEN : RED
        const pr = 8
        // кружок-пин
        ctx!.beginPath()
        ctx!.arc(sx, sy, pr, 0, Math.PI * 2)
        ctx!.fillStyle = rgba(col, 0.92)
        ctx!.fill()
        ctx!.lineWidth = 1
        ctx!.strokeStyle = "rgba(255,255,255,.65)"
        ctx!.stroke()
        // шеврон наружу (по краю)
        const ax = edge === "L" ? -1 : edge === "R" ? 1 : 0
        const ay = edge === "T" ? -1 : edge === "B" ? 1 : 0
        ctx!.beginPath()
        ctx!.moveTo(sx + ax * (pr + 5), sy + ay * (pr + 5))
        ctx!.lineTo(sx + ax * pr - ay * 4, sy + ay * pr - ax * 4)
        ctx!.lineTo(sx + ax * pr + ay * 4, sy + ay * pr + ax * 4)
        ctx!.closePath()
        ctx!.fillStyle = rgba(col, 0.92)
        ctx!.fill()
        // счётчик, если у края несколько
        if (arr.length > 1) {
          const bx = sx - ax * (pr + 9)
          const by = sy - ay * (pr + 9)
          ctx!.beginPath()
          ctx!.arc(bx, by, 8, 0, Math.PI * 2)
          ctx!.fillStyle = "rgba(11,14,20,.92)"
          ctx!.fill()
          ctx!.strokeStyle = rgba(col, 0.9)
          ctx!.stroke()
          ctx!.fillStyle = "#fff"
          ctx!.font = "700 9px " + FONT
          ctx!.fillText(String(arr.length), bx, by)
        }
        // радиус пина для хит-теста (с запасом, чтобы попадать и по бейджу)
        s.edgePins.push({ x: sx, y: sy, r: Math.max(pr, 11), node: rep })
      }
    }


    function zoomAt(cx: number, cy: number, f: number) {
      const r = cv!.getBoundingClientRect()
      const mx = cx - r.left
      const my = cy - r.top
      const wx = (mx - s.panX) / s.zoom
      const wy = (my - s.panY) / s.zoom
      s.zoom = clamp(s.zoom * f, 0.12, 9)
      s.panX = mx - wx * s.zoom
      s.panY = my - wy * s.zoom
    }

    // ---- event handlers --------------------------------------
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      userTouchedRef.current = true
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    function onMouseDown(e: MouseEvent) {
      s.isDragging = true
      s.didDrag = false
      s.startX = e.clientX
      s.startY = e.clientY
      s.startPanX = s.panX
      s.startPanY = s.panY
      cv!.classList.add("grabbing")
    }
    function onWindowMouseMove(e: MouseEvent) {
      if (s.isDragging) {
        const dx = e.clientX - s.startX
        const dy = e.clientY - s.startY
        if (Math.abs(dx) + Math.abs(dy) > 4) {
          s.didDrag = true
          userTouchedRef.current = true
        }
        s.panX = s.startPanX + dx
        s.panY = s.startPanY + dy
        s.hoverIdx = -1
        s.hoverNode = null
        hideTip()
      }
    }
    function onWindowMouseUp() {
      if (s.isDragging) {
        s.isDragging = false
        cv!.classList.remove("grabbing")
      }
    }
    function onCanvasMouseMove(e: MouseEvent) {
      if (s.isDragging) return
      const r = cv!.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      // Edge-pins hit-test (screen space, before world transform)
      for (const pin of s.edgePins) {
        const dx = mx - pin.x
        const dy = my - pin.y
        if (dx * dx + dy * dy <= pin.r * pin.r) {
          s.hoverNode = pin.node
          s.hoverIdx = pin.node.idx
          showTip(e, pin.node)
          return
        }
      }
      const wx = (mx - s.panX) / s.zoom
      const wy = (my - s.panY) / s.zoom
      let found = -1
      let foundNode: Node | null = null
      let bestD = Infinity
      for (const n of s.nodes) {
        const hr = Math.abs(n.c.pct) >= 15 ? Math.max(n.r + 9, 15) : n.r
        const R = rot(n.x, n.y)
        const dx = wx - R.x
        const dy = wy - R.y
        const dd = dx * dx + dy * dy
        if (dd <= hr * hr && dd < bestD) {
          bestD = dd
          found = n.idx
          foundNode = n
        }
      }
      s.hoverIdx = found
      s.hoverNode = foundNode
      if (found >= 0) showTip(e, foundNode!)
      else hideTip()
    }
    function onCanvasMouseLeave() {
      s.hoverIdx = -1
      s.hoverNode = null
      hideTip()
    }
    function nodeAt(mx: number, my: number): Node | null {
      for (const pin of s.edgePins) {
        const dx = mx - pin.x
        const dy = my - pin.y
        if (dx * dx + dy * dy <= pin.r * pin.r) return pin.node
      }
      const wx = (mx - s.panX) / s.zoom
      const wy = (my - s.panY) / s.zoom
      let best: Node | null = null
      let bestD = Infinity
      for (const n of s.nodes) {
        const hr = Math.abs(n.c.pct) >= 15 ? Math.max(n.r + 9, 15) : n.r
        const R = rot(n.x, n.y)
        const dx = wx - R.x
        const dy = wy - R.y
        const dd = dx * dx + dy * dy
        if (dd <= hr * hr && dd < bestD) {
          bestD = dd
          best = n
        }
      }
      return best
    }
    function onCanvasClick(e: MouseEvent) {
      if (s.didDrag) return
      // Резолвим монету по координатам клика: hoverNode может обнулиться микродвижением мыши при зажатой кнопке.
      const r = cv!.getBoundingClientRect()
      const node = s.hoverNode ?? nodeAt(e.clientX - r.left, e.clientY - r.top)
      if (!node) return
      const coin = node.c
      // Выделяем монету (визуально) — отдельный ref, чтобы draw() читал напрямую.
      // Повторный клик по этой же монете или выбор другой — просто перезаписывает id.
      selectedIdRef.current = coin.id
      // Stash the market row (with image) before navigating, so the modal header has it immediately.
      const marketRow = rows.find((r) => r.id === coin.id)
      if (marketRow) stashMarketRow(qc, marketRow)
      prefetchLinks(qc, coin.id)
      // Open the existing intercepting modal at /asset/[id].
      // AssetRow uses the same pattern.
      router.push(`/asset/${encodeURIComponent(coin.id)}`, { scroll: false })
    }

    function showTip(e: MouseEvent, node: Node) {
      const c = node.c
      const pos = c.pct >= 0
      tipEl!.innerHTML = `<b>${escapeHtml(c.symbol)}</b> ${escapeHtml(c.name)}<br><span style="color:${pos ? "#16c784" : "#ea3943"}">${fmtPct(c.pct)}</span> · ${fmtCap(c.marketCap)}`
      tipEl!.style.display = "block"
      tipEl!.style.left = e.clientX + 14 + "px"
      tipEl!.style.top = e.clientY + 14 + "px"
    }
    function hideTip() {
      tipEl!.style.display = "none"
    }

    function onResize() {
      resizeIfNeeded()
      fitView(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hideTip()
    }

    // ---- ResizeObserver for the container --------------------
    let lastVersion = -1
    const ro = new ResizeObserver(() => {
      resizeIfNeeded()
      fitView(false)
    })
    ro.observe(container)

    // ---- Mount: compute first nodes + start loop -------------
    resizeIfNeeded()
    computeNodes()
    s.labelAlpha = 0
    s.labelTarget = 1
    fitView(true)
    s.initialized = true
    s.raf = requestAnimationFrame(loop)

    // ---- Re-run computeNodes whenever the underlying coin list
    // changes OR the user-driven layoutVersion bumps (mode/topN/etc).
    let lastOrient = paramsRef.current.orient
    let lastStartView = paramsRef.current.startView
    let lastScale = paramsRef.current.scaleType
    const watchInterval = window.setInterval(() => {
      if (layoutVersionRef.current !== lastVersion) {
        lastVersion = layoutVersionRef.current
        computeNodes()
        const orientChanged = paramsRef.current.orient !== lastOrient
        const startViewChanged = paramsRef.current.startView !== lastStartView
        const scaleChanged = paramsRef.current.scaleType !== lastScale
        lastOrient = paramsRef.current.orient
        lastStartView = paramsRef.current.startView
        lastScale = paramsRef.current.scaleType
        // Пока пользователь сам не трогал вид — пере-подгоняем при каждой догрузке монет.
        if (orientChanged || startViewChanged || scaleChanged || !userTouchedRef.current) {
          fitView(true)
        }
      }
    }, 120)

    // ---- Event wiring ----------------------------------------
    cv.addEventListener("wheel", onWheel, { passive: false })
    cv.addEventListener("mousedown", onMouseDown)
    cv.addEventListener("mousemove", onCanvasMouseMove)
    cv.addEventListener("mouseleave", onCanvasMouseLeave)
    cv.addEventListener("click", onCanvasClick)
    window.addEventListener("mousemove", onWindowMouseMove)
    window.addEventListener("mouseup", onWindowMouseUp)
    window.addEventListener("resize", onResize)
    window.addEventListener("keydown", onKeyDown)

    // ---- Cleanup ---------------------------------------------
    return () => {
      cancelAnimationFrame(s.raf)
      clearInterval(watchInterval)
      ro.disconnect()
      cv.removeEventListener("wheel", onWheel)
      cv.removeEventListener("mousedown", onMouseDown)
      cv.removeEventListener("mousemove", onCanvasMouseMove)
      cv.removeEventListener("mouseleave", onCanvasMouseLeave)
      cv.removeEventListener("click", onCanvasClick)
      window.removeEventListener("mousemove", onWindowMouseMove)
      window.removeEventListener("mouseup", onWindowMouseUp)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("keydown", onKeyDown)
      hideTip()
    }
    // Run once on mount; source coins are accessed via closure above
    // (they change via paramsRef-driven relayouts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When sourceCoins changes (different market data), bump layout so
  // the watchInterval re-runs computeNodes.
  useEffect(() => {
    layoutVersionRef.current++
  }, [sourceCoins])

  // =============================================================
  // Render
  // =============================================================
  return (
    <section className="relative w-full max-w-[var(--maxw)] mx-auto mb-6">
      <div
        className={
          "overflow-hidden transition-all duration-300 ease-out " +
          (panelOpen ? "max-h-[820px] opacity-100 mb-3" : "max-h-0 opacity-0 mb-0")
        }
      >
        <div className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 pt-12">
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Collapse settings"
            title="Collapse"
            className="absolute top-3 right-3 z-[7] w-[34px] h-[34px] rounded-[9px] border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] text-[var(--text)] text-base leading-none"
          >
            ✕
          </button>
      <div className="flex flex-wrap items-baseline gap-2 mb-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Горячие монеты — Beeswarm
        </h2>
          <span className="text-xs text-[var(--text-mut)]">
            24ч · топ-{topN} · стейблы скрыты
          </span>
      </div>

      {/* Chips */}
      {stats && (
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="chip">
            <span className="text-[var(--text-mut)]">🚀 Лидер роста:</span>{" "}
            <b style={{ color: "#16c784" }}>
              {stats.top.symbol} {fmtPct(stats.top.pct)}
            </b>
          </span>
          <span className="chip">
            <span className="text-[var(--text-mut)]">🔻 Лидер падения:</span>{" "}
            <b style={{ color: "#ea3943" }}>
              {stats.bottom.symbol} {fmtPct(stats.bottom.pct)}
            </b>
          </span>
          <span className="chip">
            <span className="text-[var(--text-mut)]">📊 На графике:</span>{" "}
            <b>{sourceCoins.length}</b> монет
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
          {(
            [
              { v: "both", label: "All", cls: "" },
              { v: "gainers", label: "Gainers", cls: "text-emerald-500" },
              { v: "losers", label: "Losers", cls: "text-rose-500" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setMode(opt.v)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition " +
                (mode === opt.v
                  ? "bg-[var(--surface-2)] text-[var(--text)] " + opt.cls
                  : "text-[var(--text-mut)] hover:text-[var(--text)]")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        <SliderCtl
          label="🔍 Размер"
          min={0.4}
          max={2.6}
          step={0.1}
          value={sizeMult}
          display={sizeMult.toFixed(1) + "×"}
          onChange={setSizeMult}
        />
        <SliderCtl
          label="↔️ Шкала"
          min={6}
          max={70}
          step={1}
          value={unit}
          display={unit + " px/%"}
          onChange={setUnit}
        />
        <div className="inline-flex items-center gap-2 text-xs text-[var(--text-mut)]">
          <span>⏶ Монет</span>
          <div className="inline-flex rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
            {([100, 200, 300, 400] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setTopN(n); layoutVersionRef.current++ }}
                className={
                  "px-3 py-2 font-semibold transition " +
                  (topN === n
                    ? "bg-[var(--surface-2)] text-[var(--text)]"
                    : "text-[var(--text-mut)] hover:text-[var(--text)]")
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <Toggle label="все %" checked={showAll} onChange={setShowAll} />
        <Toggle label="📌 Пины: всё за краем" checked={pinAll} onChange={setPinAll} />
        <div className="inline-flex items-center gap-2 text-xs text-[var(--text-mut)]">
          <span>🎯 Старт</span>
          <div className="inline-flex rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
            {([["equator", "Экватор+BTC"], ["auto", "Автомасштаб"]] as const).map(([v, lbl]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setStartView(v)
                  layoutVersionRef.current++
                }}
                className={
                  "px-3 py-2 text-xs font-semibold transition " +
                  (startView === v
                    ? "bg-[var(--surface-2)] text-[var(--text)]"
                    : "text-[var(--text-mut)] hover:text-[var(--text)]")
                }
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="сжатая шкала"
          checked={scaleType === "log"}
          onChange={(v) => {
            setScaleType(v ? "log" : "linear")
            layoutVersionRef.current++
          }}
        />
        <SliderCtl
          label="🗜 Сжать пустоты"
          min={0}
          max={100}
          step={5}
          value={Math.round(squeeze * 100)}
          display={Math.round(squeeze * 100) + "%"}
          onChange={(v) => {
            setSqueeze(v / 100)
            layoutVersionRef.current++
          }}
        />
        <Toggle
          label="соты"
          checked={shape === "hex"}
          onChange={(v) => setShape(v ? "hex" : "circle")}
        />
        <button
          type="button"
          onClick={() => {
            setOrient((o) => (o === "h" ? "v" : "h"))
            layoutVersionRef.current++
          }}
          aria-pressed={orient === "v"}
          title="Rotate chart 90° (click again to revert)"
          className={
            "flex items-center gap-1.5 text-xs font-semibold rounded-[10px] px-3 py-2 border transition " +
            (orient === "v"
              ? "border-emerald-500 text-[var(--text)] bg-[var(--surface-2)]"
              : "border-[var(--border)] text-[var(--text-mut)] hover:text-[var(--text)] bg-[var(--surface)]")
          }
        >
          ⟲ Повернуть 90°
        </button>

        <SliderCtl
          label="🧲 Притяжение"
          min={0.02}
          max={0.30}
          step={0.01}
          value={gravity}
          display={gravity.toFixed(2)}
          onChange={setGravity}
        />
        <SliderCtl
          label="🥞 Сжатие"
          min={0}
          max={90}
          step={1}
          value={Math.round(flatten * 100)}
          display={Math.round(flatten * 100) + "%"}
          onChange={(v) => setFlatten(v / 100)}
        />
        <SliderCtl
          label="🧊 Плотность"
          min={0}
          max={8}
          step={0.2}
          value={density}
          display={density.toFixed(1)}
          onChange={setDensity}
        />
      </div>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={containerRef}
        className="relative w-full border border-[var(--border)] rounded-2xl overflow-hidden select-none"
        style={{
          height,
          background:
            "linear-gradient(90deg,rgba(234,57,67,.11),rgba(234,57,67,0) 40%,rgba(22,199,132,0) 60%,rgba(22,199,132,.11)),radial-gradient(130% 120% at 50% -12%,#121a2c,#0e1116 72%)",
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full z-[2] block cursor-grab"
        />
        <canvas
          ref={axisRef}
          className={"absolute z-[3] pointer-events-none " + (orient === "v" ? "top-0 bottom-0 left-0 h-full w-[46px]" : "left-0 right-0 bottom-0 w-full h-[30px]")}
          style={{
            background: "rgba(11,14,20,.82)",
            borderTop: "1px solid var(--border)",
          }}
        />
        {orient === "v" ? (
          <>
            <span className="absolute top-3 left-1/2 -translate-x-1/2 z-[4] text-[11px] font-bold text-emerald-500 pointer-events-none tracking-wide">
              ↑ рост
            </span>
            <span className="absolute bottom-9 left-1/2 -translate-x-1/2 z-[4] text-[11px] font-bold text-rose-500 pointer-events-none tracking-wide">
              падение ↓
            </span>
          </>
        ) : (
          <>
            <span className="absolute top-3 left-3 z-[4] text-[11px] font-bold text-rose-500 pointer-events-none tracking-wide">
              падение ←
            </span>
            <span className="absolute top-3 right-3 z-[4] text-[11px] font-bold text-emerald-500 pointer-events-none tracking-wide">
              → рост
            </span>
          </>
        )}
        <button
          type="button"
          aria-label="Chart settings"
          aria-pressed={panelOpen}
          title="Chart settings"
          onClick={() => setPanelOpen((o) => !o)}
          className="absolute bottom-10 right-3 z-[6] w-[34px] h-[34px] rounded-[9px] border border-[var(--border)] bg-[rgba(11,14,20,.82)] hover:bg-[rgba(40,50,74,.9)] text-[var(--text)] text-base leading-none"
        >
          ⚙️
        </button>
        <ZoomButtons
          containerRef={containerRef}
          canvasRef={canvasRef}
          stateRef={stateRef}
          layoutVersionRef={layoutVersionRef}
          userTouchedRef={userTouchedRef}
          zoomLabelRef={zoomLabelRef}
        />
      </div>

      {/* Tooltip (rendered once, positioned via stateRef in the loop) */}
      <div
        ref={tipRef}
        className="fixed z-[60] hidden bg-[#0d1119] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text)] pointer-events-none shadow-2xl max-w-[240px]"
      />

      {panelOpen && (
        <p className="text-[11.5px] text-[var(--text-mut)] mt-3 leading-relaxed">
          Живой canvas: кружки пружинами оседают к своим столбцам. Размер = капитализация,
          положение по горизонтали = % за 24ч. «Притяжение» — жёсткость пружины,
          «Сжатие» — расплющивание к экватору, «Плотность» — зазор между монетами.
          Колесо/кнопки — зум, «все %» показывает процент у каждой. Стейблы и токены,
          привязанные к золоту/облигациям, исключены. Клик по монете открывает
          карточку актива.
        </p>
      )}
    </section>
  )
}

// -------------------------------------------------------------
// Subcomponents
// -------------------------------------------------------------
function SliderCtl({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--text-mut)] bg-[var(--surface)] border border-[var(--border)] rounded-[10px] px-2.5 py-1.5">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[104px] cursor-pointer accent-emerald-500"
      />
      <span className="text-[var(--text)] font-bold min-w-[56px] text-center tabular-nums">
        {display}
      </span>
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--text-mut)] bg-[var(--surface)] border border-[var(--border)] rounded-[10px] px-2.5 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-emerald-500 cursor-pointer"
      />
      <span>{label}</span>
    </label>
  )
}

function ZoomButtons({
  containerRef,
  canvasRef,
  stateRef,
  layoutVersionRef,
  userTouchedRef,
  zoomLabelRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  userTouchedRef: React.RefObject<boolean>
  zoomLabelRef: React.RefObject<HTMLDivElement | null>
  stateRef: React.RefObject<{
    zoom: number
    panX: number
    panY: number
    nodes: Node[]
    worldMinX: number
    worldMaxX: number
    worldMinY: number
    worldMaxY: number
    cssW: number
    cssH: number
    orient: "h" | "v"
    edgePins: Array<{ x: number; y: number; r: number; node: Node }>
    fitZoom: number
    fitPanX: number
    fitPanY: number
  }>
  layoutVersionRef: React.RefObject<number>
}) {
  function zoomAtClient(cx: number, cy: number, f: number) {
    const cv = canvasRef.current
    if (!cv) return
    const r = cv.getBoundingClientRect()
    const mx = cx - r.left
    const my = cy - r.top
    const s = stateRef.current
    const wx = (mx - s.panX) / s.zoom
    const wy = (my - s.panY) / s.zoom
    s.zoom = Math.max(0.12, Math.min(9, s.zoom * f))
    s.panX = mx - wx * s.zoom
    s.panY = my - wy * s.zoom
  }
  function fit() {
    const s = stateRef.current
    if (s.cssW === 0 || s.cssH === 0) return
    // Единый путь подгона. Раньше здесь было ВТОРОЕ отдельное центрирование (по нулю),
    // которое расходилось с fitView (по середине высоты) — отсюда «двойной подгон»/дёрганье.
    // Теперь просто сбрасываем флаг ручного управления и просим движок пере-подогнать
    // тем же самым fitView через watchInterval.
    userTouchedRef.current = false
    layoutVersionRef.current++
  }
  return (
    <div className="absolute top-10 right-3 z-[5] flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => {
          const cv = canvasRef.current
          if (!cv) return
          userTouchedRef.current = true
          const r = cv.getBoundingClientRect()
          zoomAtClient(r.left + r.width / 2, r.top + r.height / 2, 1.25)
        }}
        className="w-[34px] h-[34px] rounded-[9px] border border-[var(--border)] bg-[rgba(11,14,20,.82)] hover:bg-[rgba(40,50,74,.9)] text-[var(--text)] text-base leading-none"
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => {
          const cv = canvasRef.current
          if (!cv) return
          userTouchedRef.current = true
          const r = cv.getBoundingClientRect()
          zoomAtClient(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25)
        }}
        className="w-[34px] h-[34px] rounded-[9px] border border-[var(--border)] bg-[rgba(11,14,20,.82)] hover:bg-[rgba(40,50,74,.9)] text-[var(--text)] text-base leading-none"
      >
        −
      </button>
      <div
        ref={zoomLabelRef}
        title="Current zoom (100% = fit view)"
        className="min-w-[34px] text-center text-[10px] font-semibold text-[var(--text-mut)] tabular-nums select-none px-1 py-0.5 rounded-[7px] bg-[rgba(11,14,20,.82)] border border-[var(--border)]"
      >
        100%
      </div>
      <button
        type="button"
        aria-label="Fit view"
        onClick={fit}
        title="Fit view"
        className="w-[34px] h-[34px] rounded-[9px] border border-[var(--border)] bg-[rgba(11,14,20,.82)] hover:bg-[rgba(40,50,74,.9)] text-[var(--text)] text-base leading-none"
      >
        ⤢
      </button>
    </div>
  )
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  )
}