"use client"
// components/admin/CoinEditorModal.tsx
// Centred modal for editing/adding a coin in the catalog.
// Opens over the catalog, no URL change. Closes with Escape, click on
// backdrop, or the explicit close button in the header.
import * as Dialog from "@radix-ui/react-dialog"
import { AssetEditor } from "./AssetEditor"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
}

interface CoinEditorModalProps {
  row: MarketRow
  described: Described | undefined
  onClose: () => void
}

export function CoinEditorModal({ row, described, onClose }: CoinEditorModalProps) {
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(920px,94vw)] max-h-[88vh] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <Dialog.Title className="text-base font-semibold">
              {described ? `Редактирование: ${described.name}` : `Добавить монету: ${row.name}`}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Закрыть"
              className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </div>
          <AssetEditor market={row} existing={described} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
