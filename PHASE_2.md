# PHASE_2.md — inp.one v2: живые цены + график + спарклайны

> Предусловие: Phase 1 готова (каркас Next.js 15, таблица, ResponsiveSheet, импорт каталога).
> Цель фазы: котировки в таблице обновляются быстро и без layout shift; спарклайн 24ч свой; вкладка «График» = TradingView, открывается мгновенно.
> Код/идентификаторы — английский. Не парсить сторонние сайты, только официальные API (CoinGecko, TradingView виджет).

---

## 0. Что делаем в этой фазе

1. `GET /api/prices` — edge-прокси к CoinGecko + кэш (Redis/KV), отдаёт цену/24ч для списка id.
2. `GET /api/sparklines` — 24ч ряды точек для инлайн-SVG спарклайна.
3. `PriceCell` + `usePrices` (TanStack Query) — клиентское обновление цен с polling, скелетоны, tabular-nums.
4. `Sparkline` — рендер из реальных данных, цвет по знаку 24ч.
5. TradingView Advanced widget во вкладке «График»: прогрев скрипта, `setSymbol` без пересоздания.
6. Кэш-заголовки + интервалы так, чтобы было быстро и не упереться в rate limit CoinGecko.

---

## 1. ENV (добавить в .env.local)

```bash
COINGECKO_API_KEY=...            # demo/pro ключ CoinGecko
COINGECKO_BASE=https://api.coingecko.com/api/v3   # для pro: https://pro-api.coingecko.com/api/v3
KV_REST_API_URL=...              # Upstash Redis (REST) или совместимый
KV_REST_API_TOKEN=...
PRICE_TTL_SECONDS=20             # кэш цен
SPARK_TTL_SECONDS=300            # кэш спарклайнов
```

В self-host варианте Redis поднимается в docker-compose (сервис `redis`), а KV_REST_* указывают на свой Upstash-совместимый шлюз ИЛИ заменяются на прямой клиент `ioredis` (см. §6).

---

## 2. Типы (shared)

```ts
// lib/types.ts
export type Quote = {
  price: number
  change24h: number   // проценты, например +3.47
  ts: number          // unix ms, когда получено
}

export type PricesResponse = {
  quotes: Record<string, Quote>   // ключ = coingecko_id
}

export type SparklinesResponse = {
  series: Record<string, number[]> // ключ = coingecko_id, ~24 точки за 24ч
}
```

---

## 3. /api/prices (edge route)

```ts
// app/api/prices/route.ts
import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"

export const runtime = "edge"

const BASE = process.env.COINGECKO_BASE!
const KEY = process.env.COINGECKO_API_KEY!
const TTL = Number(process.env.PRICE_TTL_SECONDS ?? 20)

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) return Response.json({ quotes: {} })

  // 1) cache lookup (по отсортированному ключу)
  const cacheKey = `prices:${[...ids].sort().join(",")}`
  const cached = await kvGet<PricesResponse>(cacheKey)
  if (cached) return json(cached)

  // 2) CoinGecko markets endpoint — одна выборка на все id
  const url = `${BASE}/coins/markets?vs_currency=usd`
    + `&ids=${encodeURIComponent(ids.join(","))}`
    + `&price_change_percentage=24h&per_page=250&page=1`
  const res = await fetch(url, {
    headers: { "x-cg-demo-api-key": KEY }, // для pro: "x-cg-pro-api-key"
    // edge fetch сам кэшируется CDN ниже через заголовки ответа
  })
  if (!res.ok) return json({ quotes: {} }, 200) // мягкая деградация, без 500

  const rows = await res.json() as Array<any>
  const now = Date.now()
  const quotes: Record<string, Quote> = {}
  for (const r of rows) {
    quotes[r.id] = {
      price: r.current_price,
      change24h: r.price_change_percentage_24h ?? 0,
      ts: now,
    }
  }
  const payload: PricesResponse = { quotes }
  await kvSetEx(cacheKey, TTL, payload)
  return json(payload)
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      // CDN-кэш: свежо TTL сек, отдаём чуть устаревшее пока ревалидируем
      "cache-control": `public, s-maxage=${process.env.PRICE_TTL_SECONDS ?? 20}, stale-while-revalidate=30`,
    },
  })
}
```

Правила:
- **Один запрос к CoinGecko на весь видимый список** (endpoint `coins/markets`), не по одной монете.
- Мягкая деградация: если CoinGecko отвечает ошибкой/лимитом — отдаём пустой/последний кэш, UI показывает прошлую цену, не падает.

---

## 4. /api/sparklines (edge route)

```ts
// app/api/sparklines/route.ts
import { NextRequest } from "next/server"
import { kvGet, kvSetEx } from "@/lib/kv"

export const runtime = "edge"
const BASE = process.env.COINGECKO_BASE!
const KEY = process.env.COINGECKO_API_KEY!
const TTL = Number(process.env.SPARK_TTL_SECONDS ?? 300)

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
  const window = req.nextUrl.searchParams.get("window") ?? "24h" // фиксируем 24h
  if (ids.length === 0) return Response.json({ series: {} })

  const series: Record<string, number[]> = {}
  const missing: string[] = []
  for (const id of ids) {
    const hit = await kvGet<number[]>(`spark:${id}:${window}`)
    if (hit) series[id] = hit; else missing.push(id)
  }

  // CoinGecko market_chart нельзя батчить — тянем недостающие параллельно, но бережно
  await Promise.all(missing.map(async id => {
    const url = `${BASE}/coins/${id}/market_chart?vs_currency=usd&days=1`
    const r = await fetch(url, { headers: { "x-cg-demo-api-key": KEY } })
    if (!r.ok) { series[id] = []; return }
    const data = await r.json() as { prices: [number, number][] }
    // прорежаем до ~24 точек (по часу), берём только значение цены
    const pts = downsample(data.prices.map(p => p[1]), 24)
    series[id] = pts
    await kvSetEx(`spark:${id}:${window}`, TTL, pts)
  }))

  return new Response(JSON.stringify({ series }), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${TTL}, stale-while-revalidate=120`,
    },
  })
}

function downsample(arr: number[], n: number): number[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)])
}
```

Замечание про лимиты: `market_chart` запрашивается по одной монете, поэтому держим длинный кэш (5 мин) и прогреваем спарклайны фоном (cron каждые ~5 мин для топ-N), чтобы юзер почти всегда читал из кэша.

---

## 5. Клиент: usePrices + PriceCell

```ts
// hooks/usePrices.ts
import { useQuery } from "@tanstack/react-query"

export function usePrices(ids: string[]) {
  const key = [...ids].sort().join(",")
  return useQuery({
    queryKey: ["prices", key],
    enabled: ids.length > 0,
    queryFn: async (): Promise<PricesResponse> => {
      const r = await fetch(`/api/prices?ids=${encodeURIComponent(key)}`)
      return r.json()
    },
    refetchInterval: 20_000,        // polling 20с
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
}
```

```tsx
// components/PriceCell.tsx
export function PriceCell({ quote }: { quote?: Quote }) {
  if (!quote) return <span className="price-skeleton" aria-hidden /> // фикс. ширина!
  const up = quote.change24h >= 0
  return (
    <span className="tabular-nums">
      {formatUsd(quote.price)}
      <span className={up ? "text-up" : "text-down"}>
        {up ? "+" : "−"}{Math.abs(quote.change24h).toFixed(2)}%
      </span>
    </span>
  )
}
```

Критично: скелетон и ячейка цены — **фиксированной ширины** (`tabular-nums` + min-width), чтобы при появлении цены не было сдвига (CLS≈0).

---

## 6. lib/kv (кэш-обёртка, чтобы менять бэкенд)

```ts
// lib/kv.ts — две реализации за одним интерфейсом
// Vercel/Upstash REST:
export async function kvGet<T>(k: string): Promise<T | null> { /* fetch KV_REST_API_URL */ }
export async function kvSetEx<T>(k: string, ttl: number, v: T): Promise<void> { /* ... */ }
// Self-host: заменить тело на ioredis-клиент к сервису `redis` из docker-compose.
```

---

## 7. TradingView во вкладке «График»

```tsx
// components/TvChart.tsx
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

// Прогрев: вызвать loadTv() заранее (например при hover по строке или idle),
// чтобы к моменту открытия вкладки скрипт уже был.
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
  // смена монеты без пересоздания виджета
  useEffect(() => {
    const w = widget.current
    if (w && w.activeChart) { try { w.activeChart().setSymbol(tvSymbol) } catch {} }
  }, [tvSymbol])
  return <div id="tv_chart" ref={ref} style= height: "100%", minHeight: 360  />
}
```

Правила:
- `tv.js` грузится **один раз** (`loadTv` синглтон), прогрев заранее → вкладка «График» открывается мгновенно.
- Смена актива — `setSymbol`, виджет не пересоздаём.
- `tvSymbol` берётся из `assets.tv_symbol` (например `BINANCE:BTCUSDT`); fallback — `BINANCE:{TICKER}USDT`.
- TradingView подключать **динамическим импортом** (`next/dynamic`, `ssr:false`), чтобы не утяжелять первый экран.

---

## 8. Прогрев и polling — правила скорости

- Спарклайны и `tv.js` прогревать в фоне (idle / hover), не блокируя первый рендер.
- Цены: polling 20с, общий запрос на видимые id; при уходе вкладки в фон — пауза (refetchOnWindowFocus вернёт свежее).
- Все ответы edge-route с `s-maxage` + `stale-while-revalidate` — повторные посетители читают с CDN.
- Никаких запросов к CoinGecko по одной монете в цикле на клиенте — только через свои `/api/*`.

---

## 9. Критерии приёмки Phase 2

- [ ] Таблица показывает реальные цены и 24ч %, обновляется каждые ~20с без сдвига разметки (CLS≈0).
- [ ] Спарклайн 24ч строится из реальных данных, цвет = знак 24ч.
- [ ] Клик по спарклайну открывает карточку на вкладке «График».
- [ ] Вкладка «График» открывается мгновенно (скрипт прогрет), смена монеты — без перезагрузки виджета.
- [ ] При ошибке/лимите CoinGecko UI не падает: показывает прошлые значения / скелетоны.
- [ ] Цены и спарклайны кэшируются (Redis/KV), повторные запросы дёшевы.
- [ ] Нет прямых обращений к CoinGecko с клиента; всё через `/api/prices` и `/api/sparklines`.

---

## 10. Дальше (Phase 3 — превью)

Аккаунты + синк watchlist (Supabase Auth: magic-link, Google OAuth, Web3 SIWE/WalletConnect для EVM), RLS на `watchlist` и `profiles`, миграция локального watchlist в аккаунт при входе. Детализирую отдельным файлом, когда дойдёшь.
