// lib/ui/asset-body-view.ts
//
// Pure decision function for the body's main slot inside AssetOverview.
// Lives here (not in components/) so it can be unit-tested without
// pulling in the React/Vaul/Dialog stack.
//
// Why this exists: when the user switches coins inside an open drawer,
// the new query is in flight. Before this guard, an empty `links`
// array (either from the previous coin's data still mounted, or from
// the initial {} shape that React Query returns while `isLoading` is
// true) would briefly render <EmptyState /> until the body's
// anti-flicker `useEffect` caught up. This helper makes the gating
// explicit and testable.

export type BodyView = "skeleton" | "empty" | "list"

export interface DecideBodyViewArgs {
  /** Parent-driven anti-flicker flag (180ms grace period). */
  showBodySkeleton: boolean
  /** React Query: `!data && isFetching`. */
  isLoading: boolean
  /** Server returned a partial payload (at least one link visible). */
  partial: boolean
  /** Number of resolved link rows for the current coin. */
  linksCount: number
  /** Number of pending (shimmer) rows for the current coin. */
  pendingCount: number
}

export function decideBodyView(args: DecideBodyViewArgs): BodyView {
  // Parent's anti-flicker flag wins (it deliberately stays true for
  // ~180ms even after isLoading flips false).
  if (args.showBodySkeleton) return "skeleton"
  // Defense-in-depth: if isLoading is true, never render EmptyState,
  // even if showBodySkeleton is somehow false.
  if (args.isLoading) return "skeleton"
  // Partial payload means the fetch succeeded for at least one link,
  // so showing EmptyState would be a regression.
  if (args.partial) return "list"
  // Clean fetch with content: render the list (with or without
  // pending shimmers).
  if (args.linksCount > 0 || args.pendingCount > 0) return "list"
  // Clean fetch, nothing returned: EmptyState.
  return "empty"
}
