"use client"

// Drawer: Vaul bottom-sheet on mobile (<md), Radix side-panel on desktop.
// Reads the SAME ["links", id] queryKey that AssetRow prefetched on hover
// (see lib/prefetch.ts). One cache, both surfaces, zero extra network.

import * as Dialog from "@radix-ui/react-dialog"
import { Drawer as VaulDrawer } from "vaul"
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { Asset, Link } from "@/types/asset"
import { AssetOverview } from "./AssetOverview"
import { linksQueryKey } from "@/lib/prefetch"

function useIsDesktop() {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(min-width:768px)")
      mq.addEventListener("change", onStoreChange)
      return () => mq.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia("(min-width:768px)").matches,
    () => false,
  )
}

interface AssetDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  coingeckoId: string | null
  /** Optional market snapshot from the table row (for the empty state). */
  market?: { name: string; symbol: string; image: string; price: number | null; change24h: number; marketCap: number | null }
}

interface LinksPayload {
  asset: Pick<Asset, "id" | "name" | "ticker" | "icon" | "coingecko_id" | "tv_symbol"> | null
  links: Link[]
  categories: { key: string; label: string; icon: string | null; sort: number }[]
}

async function fetchLinks(cg: string, signal: AbortSignal): Promise<LinksPayload> {
  const r = await fetch(`/api/links?cg=${encodeURIComponent(cg)}`, { signal })
  if (!r.ok) return { asset: null, links: [], categories: [] }
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
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed bottom-0 left-0 right-0 z-[51] bg-[var(--surface)] border-t border-[var(--border)] rounded-t-2xl max-h-[85vh] flex flex-col"
        >
          <VaulDrawer.Title className="sr-only">
            {market?.name || coingeckoId || "Asset overview"}
          </VaulDrawer.Title>
          <AssetOverview
            asset={data?.asset ?? null}
            links={data?.links ?? []}
            categories={data?.categories}
            market={market}
            isLoading={isLoading}
            variant="drawer"
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
    queryKey: coingeckoId ? linksQueryKey(coingeckoId) : ["links", "_disabled"],
    queryFn: ({ signal }) => fetchLinks(coingeckoId as string, signal),
    enabled,
    staleTime: 60_000,
  })

  return (
    <div className="hidden md:block">
      <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <Dialog.Portal>
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="drawer-panel fixed right-0 top-0 z-50 h-full w-[var(--drawer-w)] max-w-[92vw] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
          >
            <Dialog.Title className="sr-only">
              {market?.name || coingeckoId || "Asset overview"}
            </Dialog.Title>
            <AssetOverview
              asset={data?.asset ?? null}
              links={data?.links ?? []}
              categories={data?.categories}
              market={market}
              isLoading={isLoading}
              variant="drawer"
              onClose={() => onOpenChange(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
