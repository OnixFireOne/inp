// components/Shimmer.tsx
// Reusable shimmer building blocks for the asset drawer.
//
// Visual contract — single source of truth for sizes:
//   - LinkRowSkeleton reuses the exact same class as the real chip
//     (`.link-icon-btn`) and a content block of size LINK_ICON_SIZE.
//     That way any future change to the chip CSS propagates to the
//     skeleton automatically — pixel-perfect match by construction.
//   - ChipSkeleton mirrors CopyContractChip exactly via the same
//     padding/border classes the chip uses (`px-3 py-1.5 text-xs` with
//     a 1px border → 30px tall) instead of hand-rolled `h-7`.
//   - CategoryHeaderSkeleton fills the parent `text-xs` line-height (16px)
//     via `h-4` so the row height never shifts at swap time.
//
// Animation: subtle opacity pulse, NO traveling highlight. Honors
// `prefers-reduced-motion: reduce` automatically by virtue of using
// a pure opacity animation gated through `motion-safe:animate-pulse`.

"use client"

/**
 * The single icon size used everywhere in the drawer. Core tier is not
 * shipped yet — every real chip and every skeleton renders at this size,
 * totalling 20px icon + 8px×2 padding + 1px×2 border = 38×38 outer box.
 * When Core ships, update this constant AND reintroduce branching here
 * AND in LinkList in one conscious change.
 */
export const LINK_ICON_SIZE = 20

/** A single skeleton row matching the bounding box of `.link-icon-btn`. */
export function LinkRowSkeleton() {
  return (
    <span aria-hidden="true" className="link-icon-btn motion-safe:animate-pulse">
      <span
        aria-hidden="true"
        style={{ width: LINK_ICON_SIZE, height: LINK_ICON_SIZE }}
        className="rounded-md bg-white/[0.06]"
      />
    </span>
  )
}

/** Header-row skeleton matching the category-header line height (16px). */
export function CategoryHeaderSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-24 rounded-md bg-white/[0.06] motion-safe:animate-pulse"
    />
  )
}

/** Skeleton matching CopyContractChip height/width/shape exactly. */
export function ChipSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/[0.06] px-3 py-1.5 text-xs motion-safe:animate-pulse"
    >
      <span className="inline-block h-3 w-[120px] rounded bg-white/[0.04]" />
    </span>
  )
}
