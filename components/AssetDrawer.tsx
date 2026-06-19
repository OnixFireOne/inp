"use client"

// Drawer: Vaul bottom-sheet on mobile (<md), Radix side-panel on desktop.
// Reads the SAME ["links", id] queryKey that AssetRow prefetched on hover
// (see lib/prefetch.ts). One cache, both surfaces, zero extra network.

import * as Dialog from "@radix-ui/react-dialog"
import { Drawer as VaulDrawer } from "vaul"
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { Asset, Link } from "@/types/asset"
import { LinkList } from "./LinkList"
import { linksQueryKey } from "@/lib/prefetch"

function useIsDesktop() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(min-width:768px)")
      mq.addEventListener("change", onStoreChange)
      return () => mq.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia("(min-width:768px)").matches,
    () => false, // server snapshot — no window available
  )
}

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
  const isDesktop = useIsDesktop()
  if (isDesktop) {
    return <DesktopDrawer open={open} onOpenChange={onOpenChange} coingeckoId={coingeckoId} market={market} />
  }
  return <MobileDrawer open={open} onOpenChange={onOpenChange} coingeckoId={coingeckoId} market={market} />
}

function MobileDrawer({ open, onOpenChange, coingeckoId, market }: AssetDrawerProps) {
  const enabled = open && !!coingeckoId
  const { data, isLoading } = useQuery({
    queryKey: coingeckoId ? linksQueryKey(coingeckoId) : ["links", "_disabled"],
    queryFn: ({ signal }) => fetchLinks(coingeckoId as string, signal),
    enabled,
    staleTime: 60_000,
  })

  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <VaulDrawer.Content
          aria-describedby={undefined}
          className="fixed bottom-0 left-0 right-0 z-[51] bg-[var(--surface)] border-t border-[var(--border)] rounded-t-2xl max-h-[85vh] flex flex-col"
        >
          <VaulDrawer.Title className="sr-only">
            {market?.name || coingeckoId || "Asset overview"}
          </VaulDrawer.Title>
          <DrawerContent
            isLoading={isLoading}
            payload={data}
            market={market}
            onClose={() => onOpenChange(false)}
          />
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  )
}

// Desktop: Radix side-panel
function DesktopDrawer({ open, onOpenChange, coingeckoId, market }: AssetDrawerProps) {
  const enabled = open && !!coingeckoId
  const { data, isLoading } = useQuery({
    // Same queryKey as the mobile drawer + prefetch → shared cache, single network call.
    queryKey: coingeckoId ? linksQueryKey(coingeckoId) : ["links", "_disabled"],
    queryFn: ({ signal }) => fetchLinks(coingeckoId as string, signal),
    enabled,
    staleTime: 60_000,
  })

  return (
    <div className="hidden md:block">
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
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
      {/* Drag handle (mobile only) */}
      <div className="md:hidden flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-9 h-1 bg-[var(--border)] rounded-full" />
      </div>

      {/* Header */}
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

      {/* Body */}
      <div className="drawer-body flex-1 min-h-0">
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
