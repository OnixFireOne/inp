"use client"

// Drawer: Vaul bottom-sheet on mobile (<md), Radix side-panel on desktop.
// Reads the SAME ["links", id] queryKey that AssetRow / HotCoinsBeeswarm
// prefetched on hover (see lib/prefetch.ts). One cache, both surfaces, zero
// extra network on the warm path.
//
// OPEN POLICY (instant feel):
//   The drawer is rendered by parent Radix/Vaul state — `open` triggers mount.
//   The header (name, symbol, icon, price, %24h, market cap) renders
//   INSTANTLY from the `market` prop, never blocked on the network. The
//   body shows whatever links the prefetch placed in cache; if that
//   payload is `partial: true` (cold coin the user only hovered, never
//   clicked), we render the partial links + per-category shimmer slots
//   (see `pending`) and fire a FULL `/api/links` in the background —
//   that one DOES hit CoinGecko (because the user committed). The full
//   response overwrites the cache via setQueryData on the same queryKey,
//   shimmer rows are replaced by real links in place.
//
// CACHE POLICY:
//   - Links payload: staleTime 12h, gcTime 24h. Prefetch and click both
//     share this cache. A payload carries `partial=true` whenever the
//     probe classifies at least one enabled template as pending-meta —
//     that's the case for *both* the prefetch path (ensure was never
//     run on hover) AND the click path when ensure times out (5s inline).
//     The drawer upgrades any `partial` payload in the background the
//     next time that coin is opened — a click that degraded previously
//     gets a second chance to land on a full payload, no stale 12h lock.
//   - Market price/%24h/marketCap come from the `market` prop (the
//     MarketRow already on screen), refreshed by /api/markets cadence —
//     no separate query here.

import * as Dialog from "@radix-ui/react-dialog"
import { Drawer as VaulDrawer } from "vaul"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useSyncExternalStore } from "react"
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
    queryFn: ({ signal }) => fetchLinksPayload(coingeckoId as string, { signal }),
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
  const qc = useQueryClient()
  const enabled = open && !!coingeckoId
  const { data, isFetching } = useLinksPayload(coingeckoId, enabled)

  // The cache may hold a `partial` payload from either source:
  //   - prefetch (no ensure run on hover)
  //   - a previous click whose ensure timed out at 5s
  // On the next open we fire the FULL /api/links in the background —
  // this is the only call in the open path that touches CoinGecko, and
  // the user has committed by re-opening. The full response overwrites
  // the cache via setQueryData on the same queryKey; the drawer's
  // useQuery re-renders with the full payload. Shimmer slots (driven
  // by `pending`) collapse naturally because the render path is
  // identical for both shapes — only the link array changes.
  const upgradeStartedRef = useRef<string | null>(null)
  const triggerFullFetch = (id: string) => {
    const ac = new AbortController()
    fetchLinksPayload(id, { signal: ac.signal })
      .then((full) => {
        if (ac.signal.aborted) return
        qc.setQueryData<LinksPayload>(linksQueryKey(id), full)
      })
      .catch(() => {
        // Allow the next open (or Retry) to try again after a failed upgrade.
        if (!ac.signal.aborted && upgradeStartedRef.current === id) {
          upgradeStartedRef.current = null
        }
      })
    return () => ac.abort()
  }

  useEffect(() => {
    if (!enabled || !coingeckoId || !data?.partial) return
    if (upgradeStartedRef.current === coingeckoId) return
    upgradeStartedRef.current = coingeckoId
    return triggerFullFetch(coingeckoId)
  }, [enabled, coingeckoId, data?.partial])

  useEffect(() => {
    if (!open || !data || data.partial) return
    upgradeStartedRef.current = null
  }, [open, data])

  useEffect(() => {
    if (!open) upgradeStartedRef.current = null
  }, [open])

  // Retry handler — fired by the AssetOverview "Retry" button after the
  // partial upgrade has been failing for >8s. We re-fire the full fetch
  // unconditionally, regardless of whether the cache currently shows
  // partial or full (the user is asking us to refresh).
  useEffect(() => {
    if (!coingeckoId) return
    function onRetry(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id !== coingeckoId) return
      triggerFullFetch(coingeckoId!)
    }
    window.addEventListener("asset-drawer-retry", onRetry)
    return () => window.removeEventListener("asset-drawer-retry", onRetry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coingeckoId])

  // Full-payload swap done by setQueryData above; the useQuery above
  // re-renders automatically.
  const showBodySkeleton = !data && isFetching

  return (
    <AssetOverview
      asset={data?.asset ?? null}
      links={data?.links ?? []}
      categories={data?.categories}
      generated={data?.generated}
      status={data?.status}
      contract={data?.contract}
      partial={data?.partial}
      pending={data?.pending}
      hasProviderPending={data?.hasProviderPending}
      hasContractPending={data?.hasContractPending}
      coingeckoId={coingeckoId}
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