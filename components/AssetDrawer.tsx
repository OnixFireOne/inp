"use client"

// Drawer: right-side desktop sheet, vaul bottom-sheet on mobile.
// Renders curated links fetched from /api/links?cg=<id>.
// Empty state when the asset isn't in our DB.
//
// Data fetching rules:
//  - On open / hover, fetch /api/links?cg=... (hover = warm the cache).
//  - Server returns { asset, links }. asset=null => empty state.

import * as Dialog from "@radix-ui/react-dialog"
// import { Drawer as VaulDrawer } from "vaul"   // disabled for now (mobile bottom-sheet)
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import type { Asset, Link } from "@/types/asset"
import { LinkList } from "./LinkList"

interface AssetDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  coingeckoId: string | null
  /** Optional market snapshot from the table row (for the empty state). */
  market?: { name: string; symbol: string; image: string; price: number; change24h: number; marketCap: number | null }
}

interface LinksPayload {
  asset: Pick<Asset, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links: Link[]
}

async function fetchLinks(cg: string, signal: AbortSignal): Promise<LinksPayload> {
  const r = await fetch(`/api/links?cg=${encodeURIComponent(cg)}`, { signal })
  if (!r.ok) return { asset: null, links: [] }
  return (await r.json()) as LinksPayload
}

export function AssetDrawer({ open, onOpenChange, coingeckoId, market }: AssetDrawerProps) {
  const enabled = open && !!coingeckoId
  const { data, isLoading } = useQuery({
    queryKey: ["links", coingeckoId],
    queryFn: ({ signal }) => fetchLinks(coingeckoId as string, signal),
    enabled,
    staleTime: 60_000,
  })

  // ESC to close (Radix handles it; this is for Vaul fallback).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  return (
    <>
      {/* Desktop drawer (Radix Dialog, non-modal — clicking another row swaps content via the table). */}
      <div className="hidden md:block">
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Portal>
            <Dialog.Content
              aria-describedby={undefined}
              className="drawer-panel fixed right-0 top-0 z-50 h-full w-[var(--drawer-w)] max-w-[92vw] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
            >
              <Dialog.Title className="sr-only">
                {market?.name || coingeckoId || "Asset overview"}
              </Dialog.Title>

              <DrawerContent
                isLoading={isLoading}
                payload={data}
                market={market}
                onClose={() => onOpenChange(false)}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* Mobile bottom-sheet (vaul) — temporarily disabled per request */}
      {/* <div className="md:hidden"> ... </div> */}
    </>
  )
}

function DrawerContent({
  isLoading,
  payload,
  market,
  onClose,
}: {
  isLoading: boolean
  payload?: LinksPayload
  market?: AssetDrawerProps["market"]
  onClose: () => void
}) {
  const asset = payload?.asset
  const links = payload?.links ?? []
  const displayName = asset?.name ?? market?.name ?? ""
  const displaySymbol = asset?.ticker ?? market?.symbol ?? ""
  const icon = asset?.icon ?? market?.image ?? ""

  return (
    <>
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
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-btn w-9 h-9"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="drawer-body flex-1">
        <div className="drawer-scroll p-5">
          {isLoading ? (
            <DrawerSkeleton />
          ) : links.length === 0 ? (
            <EmptyState />
          ) : (
            <LinkList links={links} />
          )}
        </div>
      </div>
    </>
  )
}

function DrawerSkeleton() {
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
