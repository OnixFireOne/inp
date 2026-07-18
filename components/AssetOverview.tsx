"use client"

// AssetOverview — shared presentation for an asset (header + links).
// Used by:
//   - AssetDrawer (variant="drawer")  — client-state panel with onClose
//   - app/asset/[id]/page.tsx (variant="page") — full SEO page
//
// Drawer-only chrome (drag handle, close button) is rendered only when
// variant="drawer". In "page" mode the parent page supplies its own header.
//
// PARTIAL PAYLOAD HANDLING (drawer only):
//   When the cache holds a `partial: true` payload (cold coin the user
//   only hovered, never clicked), we forward `pending` + `hasContractPending`
//   to <LinkList> + the contract-chip slot. LinkList reserves shimmer rows
//   per pending category, and the contract chip slot becomes a shimmer
//   pill of the same height. The drawer also fires the full /api/links
//   request in the background (see AssetDrawer); when the full payload
//   arrives, setQueryData swaps the cache under the same key, RQ re-renders,
//   shimmers disappear, real links appear in their place — no layout shift
//   because the reservations matched the eventual real count or collapsed
//   cleanly when the real count was lower.

import { useEffect, useState } from "react"
import { LinkList } from "./LinkList"
import { GeneratedBadge } from "./GeneratedBadge"
import { CategoryHeaderSkeleton, ChipSkeleton, LinkRowSkeleton } from "./Shimmer"
import type { Link } from "@/types/asset"
import { decideBodyView } from "@/lib/ui/asset-body-view"

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
  status?: "described" | "template" | "undescribed" | null
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
  generated?: boolean
  status?: "described" | "template" | "undescribed"
  /** Native-chain contract from the CoinGecko snapshot, if any. */
  contract?: { chain: string; address: string } | null
  /** True ONLY when we have no cached links AND a fetch is in flight. */
  isLoading?: boolean
  /** Partial-payload shape from the prefetch path. */
  partial?: boolean
  pending?: { categoryKey: string; count: number }[]
  hasProviderPending?: boolean
  hasContractPending?: boolean
  /** CoinGecko id — needed so the retry button (see below) can fire a fresh
   *  full /api/links on demand. */
  coingeckoId?: string | null
  variant: "drawer" | "page"
  onClose?: () => void
}

// Compact price block used in the drawer header. No external deps — we have
// the values already in the MarketRow prop.
function PriceBlock({ market }: { market?: AssetOverviewMarket }) {
  if (!market) return null
  const price =
    market.price == null
      ? "—"
      : market.price >= 1
        ? `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : `$${market.price.toPrecision(4)}`
  const pct = market.change24h
  const pctPos = pct >= 0
  return (
    <div className="flex items-center gap-3 text-sm tabular-nums">
      <span className="font-semibold">{price}</span>
      <span style={{ color: pctPos ? "#16c784" : "#ea3943" }}>
        {pctPos ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
      {market.marketCap != null && (
        <span className="text-[var(--text-mut)] text-xs">
          cap ${marketCapShort(market.marketCap)}
        </span>
      )}
    </div>
  )
}

function marketCapShort(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(v)
}

export function AssetOverview({
  asset,
  links,
  market,
  categories,
  generated,
  status,
  contract,
  isLoading = false,
  partial = false,
  pending,
  hasContractPending,
  coingeckoId,
  variant,
  onClose,
}: AssetOverviewProps) {
  const displayName = asset?.name ?? market?.name ?? ""
  const displaySymbol = asset?.ticker ?? market?.symbol ?? ""
  const icon = asset?.icon ?? market?.image ?? ""

  // The contract chip slot is reserved whenever we either already have a
  // contract (real) or are still waiting on meta (shimmer). On a cold
  // load (`isLoading`, no cache yet) we don't yet know whether the
  // snapshot has a contract — so we reserve the slot too, otherwise the
  // chip would pop in once the payload arrives and shift the body down.
  // Both branches share the exact same row in the JSX so the layout
  // never shifts when a partial payload upgrades to full.
  const contractSlotOccupied = !!contract
  const contractSlotPending = !contract && (!!hasContractPending || isLoading)

  // Anti-flicker delay for the body skeleton: if the cached payload
  // resolves in <150ms, we don't paint shimmer at all. The spec asks for
  // a 150–200ms gate.
  const [showBodySkeleton, setShowBodySkeleton] = useState(isLoading)
  useEffect(() => {
    if (!isLoading) {
      setShowBodySkeleton(false)
      return
    }
    const t = setTimeout(() => setShowBodySkeleton(true), 180)
    return () => clearTimeout(t)
  }, [isLoading])

  return (
    <>
      {/* Drag handle (mobile drawer only) */}
      {variant === "drawer" && (
        <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 bg-[var(--border)] rounded-full" />
        </div>
      )}

      {/* Header — renders INSTANTLY from the market prop. No network wait. */}
      {variant === "drawer" && (
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border)] shrink-0">
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
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold truncate">{displayName || "—"}</span>
                <GeneratedBadge generated={generated} status={status ?? asset?.status ?? undefined} />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-[var(--text-mut)] uppercase">{displaySymbol}</span>
                {market && (
                  <>
                    <span className="text-[var(--text-mut)] text-xs">·</span>
                    <PriceBlock market={market} />
                  </>
                )}
              </div>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="icon-btn w-9 h-9 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Contract slot — fixed height row so the header doesn't shift when
          the chip swaps between real/shimmer/none. */}
      {variant === "drawer" && (contractSlotOccupied || contractSlotPending) && (
        <div className="px-5 pt-3 pb-1 shrink-0 min-h-[40px] flex items-center">
          {contractSlotOccupied ? (
            <CopyContractChip chain={contract!.chain} address={contract!.address} />
          ) : (
            <ChipSkeleton />
          )}
        </div>
      )}

      {/* Body — LinkList area. Skeleton only here. */}
      <div className={variant === "drawer" ? "drawer-body flex-1 min-h-0" : ""}>
        <div className={variant === "drawer" ? "drawer-scroll p-5" : "p-6"}>
          {(() => {
            const view = decideBodyView({
              showBodySkeleton,
              isLoading,
              partial,
              linksCount: links.length,
              pendingCount: pending?.length ?? 0,
            })
            if (view === "skeleton") return <BodySkeleton />
            if (view === "empty") return <EmptyState />
            return (
              <LinkList
                links={links}
                categories={categories}
                pending={pending}
                hasContractPending={hasContractPending}
                coingeckoId={coingeckoId}
              />
            )
          })()}
          {/* Partial state footer: visible only while we're waiting for the
              full payload. The Retry button is the timeout/error fallback —
              AssetDrawer fires the full fetch in the background, so this
              only appears if that fetch has been failing for >8s. */}
          {partial && links.length > 0 && (
            <PartialFooter coingeckoId={coingeckoId} />
          )}
        </div>
      </div>
    </>
  )
}

// Compact footer that surfaces a Retry if the upgrade fetch takes too long
// or has failed. Mounts only on the partial state (prefetch-shaped cache).
function PartialFooter({ coingeckoId }: { coingeckoId?: string | null }) {
  const [showRetry, setShowRetry] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setShowRetry(true), 8000)
    return () => clearTimeout(t)
  }, [])

  if (!showRetry) {
    return (
      <div className="mt-4 text-[11px] text-[var(--text-mut)]">
        Подгружаем дополнительные ссылки…
      </div>
    )
  }

  return (
    <div className="mt-4 text-xs text-[var(--text-mut)] flex items-center gap-3">
      <span>Не удалось догрузить ссылки на блокчейн.</span>
      <RetryButton coingeckoId={coingeckoId} />
    </div>
  )
}

function RetryButton({ coingeckoId }: { coingeckoId?: string | null }) {
  if (!coingeckoId) return null
  return (
    <button
      type="button"
      onClick={() => {
        // Window event — AssetDrawer listens and forces a fresh full fetch.
        window.dispatchEvent(new CustomEvent("asset-drawer-retry", { detail: { id: coingeckoId } }))
      }}
      className="rounded border border-[var(--border)] px-2 py-1 text-[11px] hover:bg-[var(--surface-2)]"
    >
      Retry
    </button>
  )
}

// Cold-load skeleton uses neutral category headers because the actual
// category metadata has not arrived yet.
function BodySkeleton() {
  const groups: Array<"Core" | "Trusted"> = ["Core", "Trusted", "Trusted", "Trusted"]
  return (
    <div className="space-y-6" aria-busy="true">
      {groups.map((tier, groupIndex) => (
        <section key={groupIndex}>
          <div className="text-xs uppercase tracking-wide mb-2">
            <CategoryHeaderSkeleton />
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: groupIndex === 0 ? 2 : 3 }).map((_, itemIndex) => (
              <LinkRowSkeleton key={itemIndex} tier={tier} id={`skel:cold:${groupIndex}:${itemIndex}`} />
            ))}
          </div>
        </section>
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

// -------------------------------------------------------------
// CopyContractChip
// -------------------------------------------------------------
// Shows the native-chain contract address with a one-click copy. Designed
// to be the FIRST thing a memecoin trader sees — pasting the address into
// their wallet/Dextool is the dominant action after recognising a coin.
// State machine: "copy" → "copied" → reverts after 1.5s. We don't show
// errors (clipboard API failures aren't actionable here).
// -------------------------------------------------------------
function CopyContractChip({ chain, address }: { chain: string; address: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle")

  // Show first 6 / last 4 chars like explorers do. Fall back to the whole
  // string for very short addresses.
  const short =
    address.length > 12
      ? `${address.slice(0, 6)}…${address.slice(-4)}`
      : address

  async function onCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(address)
        setState("copied")
        setTimeout(() => setState("idle"), 1500)
      }
    } catch {
      /* clipboard not available; ignore — the address is still readable */
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={`${chain}: ${address}`}
      aria-label={`Скопировать контракт ${address}`}
      className="inline-flex items-center gap-2 max-w-full rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--surface)] cursor-pointer"
    >
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-mut)]">
        CA · {chain}
      </span>
      <span className="font-mono text-[var(--text)] truncate">{short}</span>
      <span aria-hidden className="text-[var(--text-mut)]">
        {state === "copied" ? "✓" : "⧉"}
      </span>
    </button>
  )
}