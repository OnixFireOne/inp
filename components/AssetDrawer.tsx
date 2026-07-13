"use client"

// Drawer: Vaul bottom-sheet on mobile (<md), Radix side-panel on desktop.
// Reads the SAME ["links", id] queryKey that AssetRow / HotCoinsBeeswarm
// prefetched on hover (see lib/prefetch.ts). One cache, both surfaces, zero
// extra network.
//
// OPEN POLICY (instant feel):
//   The drawer is rendered by parent Radix/Vaul state — `open` triggers mount.
//   Children MUST NOT block on the network: the header (name, symbol, icon,
//   price, 24h%, market cap) is sourced from `market` prop which is always
//   available (it's the MarketRow behind every tile). Only the LinkList area
//   shows skeletons while /api/links is in flight. Even then, if the cache is
//   hot (recently opened this coin), we render the cached list and update it
//   silently when the refetch resolves.
//
// CACHE POLICY (links query only):
//   - linksPayload (curated/template links + asset identity + contract):
//     staleTime 12h, gcTime 24h — these are admin-curated and only change
//     when the admin bumps the KV cache-version token. Repeat opens of the
//     same coin are pure cache hits; no skeleton; no network.
//   - Market price/%24h/marketCap are NOT refetched here — they come from
//     the `market` prop (the MarketRow already on screen), refreshed by the
//     /api/markets cadence. Adding a separate query would just round-trip
//     data that's already 1 render old.

import * as Dialog from "@radix-ui/react-dialog"
import { Drawer as VaulDrawer } from "vaul"
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { AssetOverview } from "./AssetOverview"
import {
  fetchLinksPayload,
  linksQueryKey,
  type LinksPayload,
  LINKS_STALE_MS,
  LINKS_GC_MS,
} from "@/lib/prefetch"

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
  /** Market snapshot from the table row / tile. Powers the header INSTANTLY
   *  (price, %24h, market cap, name, symbol, icon) without waiting for /api/links. */
  market?: { name: string; symbol: string; image: string; price: number | null; change24h: number; marketCap: number | null }
}

function useLinksPayload(coingeckoId: string | null, enabled: boolean) {
  return useQuery<LinksPayload>({
    queryKey: coingeckoId ? linksQueryKey(coingeckoId) : ["links", "_disabled"],
    queryFn: ({ signal }) => fetchLinksPayload(coingeckoId as string, signal),
    enabled: enabled && !!coingeckoId,
    staleTime: LINKS_STALE_MS,
    gcTime: LINKS_GC_MS,
  })
}

export function AssetDrawer({ open, onOpenChange, coingeckoId, market }: AssetDrawerProps) {
  const isDesktop = useIsDesktop()
  const handleClose = () => onOpenChange(false)
  if (isDesktop) {
    return <DesktopDrawer open={open} onOpenChange={onOpenChange} coingeckoId={coingeckoId} market={market} onClose={handleClose} />
  }
  return <MobileDrawer open={open} onOpenChange={onOpenChange} coingeckoId={coingeckoId} market={market} onClose={handleClose} />
}

interface BodyProps {
  open: boolean
  coingeckoId: string | null
  market: AssetDrawerProps["market"]
  onClose: () => void
}

function DrawerBody({ open, coingeckoId, market, onClose }: BodyProps) {
  const enabled = open && !!coingeckoId
  const { data, isFetching } = useLinksPayload(coingeckoId, enabled)

  // Render cached body if available, even during background refetch — the
  // big UX win: A → B → A returns instantly with zero skeleton because the
  // payload is in RQ cache for 12h.
  const showBodySkeleton = !data && isFetching

  return (
    <AssetOverview
      asset={data?.asset ?? null}
      links={data?.links ?? []}
      categories={data?.categories}
      generated={data?.generated}
      status={data?.status}
      contract={data?.contract}
      market={market}
      isLoading={showBodySkeleton}
      variant="drawer"
      onClose={onClose}
    />
  )
}

function MobileDrawer(props: AssetDrawerProps & { onClose: () => void }) {
  return (
    <VaulDrawer.Root open={props.open} onOpenChange={props.onOpenChange} shouldScaleBackground={false}>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <VaulDrawer.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed bottom-0 left-0 right-0 z-[51] bg-[var(--surface)] border-t border-[var(--border)] rounded-t-2xl max-h-[85vh] flex flex-col"
        >
          <VaulDrawer.Title className="sr-only">
            {props.market?.name || props.coingeckoId || "Asset overview"}
          </VaulDrawer.Title>
          <DrawerBody open={props.open} coingeckoId={props.coingeckoId} market={props.market} onClose={props.onClose} />
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  )
}

// Desktop: Radix side-panel
function DesktopDrawer(props: AssetDrawerProps & { onClose: () => void }) {
  return (
    <div className="hidden md:block">
      <Dialog.Root open={props.open} onOpenChange={props.onOpenChange} modal={false}>
        <Dialog.Portal>
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="drawer-panel fixed right-0 top-0 z-50 h-full w-[var(--drawer-w)] max-w-[92vw] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
          >
            <Dialog.Title className="sr-only">
              {props.market?.name || props.coingeckoId || "Asset overview"}
            </Dialog.Title>
            <DrawerBody open={props.open} coingeckoId={props.coingeckoId} market={props.market} onClose={props.onClose} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}