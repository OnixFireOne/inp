"use client"

// AssetOverview — shared presentation for an asset (header + links).
// Used by:
//   - AssetDrawer (variant="drawer")  — client-state panel with onClose
//   - app/asset/[id]/page.tsx (variant="page") — full SEO page
//
// Drawer-only chrome (drag handle, close button) is rendered only when
// variant="drawer". In "page" mode the parent page supplies its own header.

import { LinkList } from "./LinkList"
import type { Link } from "@/types/asset"

export interface AssetOverviewMarket {
  name: string
  symbol: string
  image: string
  price: number | null
  change24h: number
  marketCap: number | null
}

export interface AssetOverviewAsset {
  id: string
  name: string
  ticker: string
  icon?: string | null
  coingecko_id?: string | null
  tv_symbol?: string | null
}

export interface CategoryMeta {
  key: string
  label: string
  icon: string | null
  sort: number
}

interface AssetOverviewProps {
  asset: AssetOverviewAsset | null
  links: Link[]
  market?: AssetOverviewMarket
  categories?: CategoryMeta[]
  isLoading?: boolean
  variant: "drawer" | "page"
  onClose?: () => void
}

export function AssetOverview({
  asset,
  links,
  market,
  categories,
  isLoading = false,
  variant,
  onClose,
}: AssetOverviewProps) {
  const displayName = asset?.name ?? market?.name ?? ""
  const displaySymbol = asset?.ticker ?? market?.symbol ?? ""
  const icon = asset?.icon ?? market?.image ?? ""

  return (
    <>
      {/* Drag handle (mobile drawer only) */}
      {variant === "drawer" && (
        <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 bg-[var(--border)] rounded-full" />
        </div>
      )}

      {/* Header (drawer variant has close button; page variant renders its own header in parent) */}
      {variant === "drawer" && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon}
                alt=""
                width={44}
                height={44}
                className="w-11 h-11 rounded-full bg-[var(--surface-2)]"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-[var(--surface-2)]" />
            )}
            <div className="min-w-0">
              <div className="font-semibold truncate">{displayName || "—"}</div>
              <div className="text-xs text-[var(--text-mut)] uppercase">{displaySymbol}</div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="icon-btn w-9 h-9">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className={variant === "drawer" ? "drawer-body flex-1 min-h-0" : ""}>
        <div className={variant === "drawer" ? "drawer-scroll p-5" : "p-6"}>
          {isLoading ? (
            <Skeleton />
          ) : links.length === 0 ? (
            <EmptyState />
          ) : (
            <LinkList links={links} categories={categories} />
          )}
        </div>
      </div>
    </>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 w-40 bg-[var(--surface-2)] rounded animate-pulse" />
      <div className="h-3 w-24 bg-[var(--surface-2)] rounded animate-pulse" />
      <div className="h-3 w-32 bg-[var(--surface-2)] rounded animate-pulse" />
      <div className="h-px bg-[var(--border)] my-4" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 bg-[var(--surface-2)] rounded animate-pulse" />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-10 text-center">
      <div className="text-4xl opacity-30 mb-3">🔗</div>
      <div className="font-medium mb-1">Курируемых ссылок пока нет</div>
      <div className="text-sm text-[var(--text-mut)]">
        Мы ещё не добавили этот актив в каталог.
      </div>
    </div>
  )
}
