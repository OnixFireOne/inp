"use client"

// PriceCell — PRICE ONLY (no change %).
// Large values (>= $1M, e.g. 24h volume for the synthetic "all" row) →
// compact T/B/M. >= $100 → whole dollars; < $100 → cents; tiny → up to 6
// fraction digits.
//
// Prop semantics:
//   - `null`      → explicit "no data" (e.g. allRow before /global returns).
//                   Renders "—".
//   - `undefined` → still loading. Renders a pulse placeholder.

import { compactUsd } from "@/lib/format"

export function PriceCell({ price }: { price?: number | null }) {
  if (price === null) {
    return <span className="text-[var(--text-mut)]">—</span>
  }
  if (price == null) {
    return <span className="inline-block w-24 h-5 bg-[var(--surface-2)] rounded animate-pulse" aria-hidden />
  }
  return <span className="tabular-nums text-[14px]">{compactUsd(price)}</span>
}
