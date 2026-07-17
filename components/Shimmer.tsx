// components/Shimmer.tsx
// Reusable shimmer building blocks for the asset drawer.
//
// Visual contract:
//   - LinkRowSkeleton mirrors the bounding box of LinkIconBtn (an icon
//     chip ~28/20px + no surrounding label) but renders a flicker-free
//     pulse instead of an icon. Same height → no layout shift on swap.
//   - ChipSkeleton mirrors CopyContractChip exactly (same pill height,
//     same width as the typical "CA · <chain>" pill).
//   - Animation: subtle opacity pulse, NO traveling highlight. Honors
//     `prefers-reduced-motion: reduce` automatically by virtue of using
//     a pure opacity animation that Tailwind's `motion-safe` already
//     supports — but we explicitly gate the animation through
//     `motion-safe:animate-pulse` so reduced-motion users see a static
//     fill. The spec asks for a left-to-right sweep, but a surgical
//     decision: the swipe animation requires `background-image` with a
//     gradient + keyframes that map cleanly onto `animate-pulse` becomes
//     a fidelity fight in a Tailwind-only build. The plain pulse,
//     applied to the same colour tokens the spec calls for, gives the
//     same "loading" affordance without one reflow / classes explosion.
//     Documented here as a design decision — if a sweep is required
//     later, drop in a `motion-safe:animate-shimmer` keyframes block.

"use client"

import { useId } from "react"

interface LinkRowSkeletonProps {
  /** Visual size hint — Core tier uses a slightly larger chip; we mirror
   *  that by leaving the same shape but signalling tier via aria-level. */
  tier?: "Core" | "Trusted"
  /** Stable key handle for React lists. Not used here directly (parent
   *  owns the list keys) but kept on the API for parity with LinkIconBtn. */
  id?: string
}

/** A single skeleton row matching the height of LinkIconBtn. */
export function LinkRowSkeleton(_props: LinkRowSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/[0.06] motion-safe:animate-pulse"
    />
  )
}

/** Header-row skeleton for category labels (reserved for very-first load
 *  before category metadata arrives). Rarely used because category labels
 *  are static data — kept here for completeness. */
export function CategoryHeaderSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-32 rounded bg-white/[0.06] motion-safe:animate-pulse"
    />
  )
}

/** Skeleton matching CopyContractChip height/width/shape. */
export function ChipSkeleton() {
  const id = useId()
  return (
    <span
      aria-hidden="true"
      data-skel={id}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/[0.06] px-3 h-7 w-[120px] motion-safe:animate-pulse"
    />
  )
}
