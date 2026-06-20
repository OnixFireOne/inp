"use client"
// components/admin/CoinEditorModal.tsx
// Client-state modal for editing/adding a coin in the catalog.
// Desktop: Radix Dialog (side panel, table scrollable behind).
// Mobile: Vaul bottom-sheet.
// No URL change — opens over the catalog, closes with Escape or explicit close.
import { useSyncExternalStore } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Drawer as VaulDrawer } from "vaul"
import { AssetEditor } from "./AssetEditor"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
}

function useIsMobile() {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {}
      const mq = window.matchMedia("(max-width:767px)")
      mq.addEventListener("change", onStoreChange)
      return () => mq.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia("(max-width:767px)").matches,
    () => false,
  )
}

interface CoinEditorModalProps {
  row: MarketRow
  described: Described | undefined
  onClose: () => void
}

export function CoinEditorModal({ row, described, onClose }: CoinEditorModalProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <VaulDrawer.Root open onOpenChange={(o) => { if (!o) onClose() }} shouldScaleBackground={false}>
        <VaulDrawer.Portal>
          <VaulDrawer.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <VaulDrawer.Content className="fixed bottom-0 left-0 right-0 z-[51] bg-[var(--surface)] border-t border-[var(--border)] rounded-t-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-9 h-1 bg-[var(--border)] rounded-full" />
            </div>
            <div className="flex items-center justify-end px-4 pb-2">
              <button onClick={onClose} aria-label="Закрыть" className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-mut)] hover:text-[var(--text)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto">
              <AssetEditor market={row} existing={described} onClose={onClose} />
            </div>
          </VaulDrawer.Content>
        </VaulDrawer.Portal>
      </VaulDrawer.Root>
    )
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-transparent" />
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            className="fixed right-0 top-0 z-50 h-full w-full max-w-[520px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
          >
            <Dialog.Title className="sr-only">
              {described ? `Редактирование: ${described.name}` : `Добавить монету: ${row.name}`}
            </Dialog.Title>
          {/* Modal header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
            <div className="font-medium">{described ? "Редактирование" : "Добавить монету"}</div>
            <button onClick={onClose} aria-label="Закрыть" className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-mut)] hover:text-[var(--text)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 px-5 py-4 overflow-y-auto">
            <AssetEditor market={row} existing={described} onClose={onClose} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
