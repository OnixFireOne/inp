// lib/links/upgrade-fetch.ts
// Extracted from AssetDrawer for testability.
//
// The drawer holds a "partial" payload (prefetch path / click-time ensure
// timeout). On mount it triggers a full `/api/links` to upgrade the cache.
// Two complications make this delicate:
//
//   1. React StrictMode in dev mounts effects TWICE (mount → cleanup →
//      mount). A naive guard ref + immediate fetch fires two requests and
//      aborts the first; the second lives but the SERVER still processes
//      the aborted one (Node doesn't cancel promises), grabbing the
//      single-flight ensure lock and racing the second caller's
//      `kvSetNx → skipped`.
//   2. Real users open the same hot coin rapidly and trigger StrictMode-
//      like remount noise; same race as the dev path.
//
// Strategy:
//   1. Defer the upgrade start by ~100ms via setTimeout. Cleanup cancels
//      the timer, so the StrictMode-induced second mount collapses to a
//      single, delayed network request — the first mount's timer never
//      fires.
//   2. AbortController is created inside the deferred timer so the
//      cleanup actually has something to abort on real unmount.
//   3. If the upgrade response is itself still partial, schedule ONE
//      auto-retry after `PARTIAL_AUTORETRY_MS` to catch the case where
//      the background ensure still finished after the 5s timeout fired.
//   4. On cleanup, reset the dedupe guard so the next mount can start
//      a fresh attempt instead of being silently skipped.
//
// This module owns NO state — callers pass a `guard` they own. We pass
// `guard` as a plain ref-like object so tests can directly inspect it.

import { fetchLinksPayload, linksQueryKey, type LinksPayload } from "../prefetch"

export interface UpgradeGuard {
  /** The id currently in flight (or just completed). null = free. */
  current: string | null
}

export interface UpgradeDeps {
  /** Internal cache writer (React Query's setQueryData in real use). */
  setPayload: (id: string, payload: LinksPayload) => void
  /** Real fetch used in production. */
  fetch: typeof fetchLinksPayload
  /** Optional clock override for tests. */
  now?: () => number
  /** Optional setTimeout override for tests. */
  setTimeout?: typeof globalThis.setTimeout
  /** Optional clearTimeout override for tests. */
  clearTimeout?: typeof globalThis.clearTimeout
}

export const UPGRADE_DELAY_MS = 100
export const PARTIAL_AUTORETRY_MS = 4000

/**
 * Schedule an upgrade fetch for `id` against the cached payload
 * `isPartial: boolean` signal:
 *
 *   - if `isPartial` is false: no-op (already full).
 *   - if a fetch is already in flight for `id`: no-op (guard blocks).
 *   - otherwise: schedule the fetch after UPGRADE_DELAY_MS.
 *
 * Returns a cleanup function that:
 *   - cancels the deferred timer if the fetch hasn't started;
 *   - aborts the in-flight fetch (if any) and the auto-retry timer;
 *   - resets the guard so the next mount can try again.
 */
export function scheduleUpgrade(args: {
  id: string | null
  isPartial: boolean
  enabled: boolean
  guard: UpgradeGuard
  deps: UpgradeDeps
}): () => void {
  const { id, isPartial, enabled, guard, deps } = args
  if (!enabled || !id || !isPartial) return () => {}
  if (guard.current === id) return () => {}

  guard.current = id
  const setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout
  const clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout
  const fetchFn = deps.fetch
  let cancelled = false
  let fetchController: AbortController | null = null
  let autoRetryTimer: ReturnType<typeof setTimeout> | null = null

  const timer = setTimeoutFn(() => {
    if (cancelled) return
    const ac = new AbortController()
    fetchController = ac
    fetchFn(id, { signal: ac.signal })
      .then((full: LinksPayload) => {
        if (cancelled || ac.signal.aborted) return
        deps.setPayload(id, full)
        if (full.partial) {
          // Reset guard here so the auto-retry below can run unimpeded.
          if (guard.current === id) guard.current = null
          autoRetryTimer = setTimeoutFn(() => {
            if (cancelled) return
            const retryAc = new AbortController()
            fetchController = retryAc
            fetchFn(id, { signal: retryAc.signal })
              .then((r2: LinksPayload) => {
                if (cancelled || retryAc.signal.aborted) return
                deps.setPayload(id, r2)
                if (r2.partial && guard.current === id) guard.current = null
              })
              .catch(() => {/* user can Retry */})
          }, PARTIAL_AUTORETRY_MS)
        }
      })
      .catch(() => {
        if (!cancelled && !ac.signal.aborted && guard.current === id) {
          guard.current = null
        }
      })
  }, UPGRADE_DELAY_MS)

  return () => {
    cancelled = true
    clearTimeoutFn(timer)
    if (fetchController) fetchController.abort()
    if (autoRetryTimer) clearTimeoutFn(autoRetryTimer)
    if (guard.current === id) guard.current = null
  }
}
