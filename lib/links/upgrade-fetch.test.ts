// lib/links/upgrade-fetch.test.ts
// Regression coverage for the StrictMode / re-mount race that produced the
// "shimmer hangs until Retry" bug. The fix is to defer the upgrade via
// setTimeout so that the StrictMode double-invoke collapses to a single
// network request instead of firing two (the second one losing the
// single-flight ensure lock on the server).

import { describe, expect, it, vi } from "vitest"

import {
  scheduleUpgrade,
  UPGRADE_DELAY_MS,
  PARTIAL_AUTORETRY_MS,
  type UpgradeGuard,
} from "./upgrade-fetch"
import type { LinksPayload } from "../prefetch"

function makeFakeClock() {
  const handlers: Array<{ id: number; at: number; fn: () => void; cancelled: boolean }> = []
  let now = 0
  let nextId = 0
  return {
    now: () => now,
    setTimeout: ((fn: () => void, ms: number) => {
      const h = { id: nextId++, at: now + ms, fn, cancelled: false }
      handlers.push(h)
      return h as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof globalThis.setTimeout,
    clearTimeout: ((h: unknown) => {
      const entry = handlers.find((x) => x === h)
      if (entry) entry.cancelled = true
    }) as unknown as typeof globalThis.clearTimeout,
    advance: (ms: number) => {
      now += ms
      // Drain all currently-due handlers. Newly-scheduled timers during
      // this pass are picked up on subsequent advances (matching how
      // real setTimeout queues work).
      let progress = true
      while (progress) {
        progress = false
        for (const h of handlers) {
          if (!h.cancelled && h.at <= now) {
            h.cancelled = true
            h.fn()
            progress = true
          }
        }
      }
    },
  }
}

function fullPayload(): LinksPayload {
  return { asset: null, links: [], categories: [], partial: false }
}
function partialPayload(): LinksPayload {
  return { asset: null, links: [], categories: [], partial: true }
}

describe("scheduleUpgrade", () => {
  it("fires exactly one fetch after StrictMode double mount/cleanup/mount", () => {
    const clock = makeFakeClock()
    const fetchSpy = vi.fn(async (_id: string) => fullPayload())
    const guard: UpgradeGuard = { current: null }

    // StrictMode mount #1
    const cleanup1 = scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })

    // StrictMode cleanup #1 (still inside the 100ms defer window)
    cleanup1()

    // StrictMode mount #2 (the real one that survives)
    const cleanup2 = scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })

    // Advance past the defer window.
    clock.advance(UPGRADE_DELAY_MS + 1)

    // Cleanup at end of life (e.g. drawer closes).
    cleanup2()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(guard.current).toBeNull()
  })

  it("does not fire a fetch when the cached payload is already full", () => {
    const clock = makeFakeClock()
    const fetchSpy = vi.fn(async (_id: string) => fullPayload())
    const guard: UpgradeGuard = { current: null }
    const cleanup = scheduleUpgrade({
      id: "bitcoin",
      isPartial: false,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })
    clock.advance(UPGRADE_DELAY_MS * 5)
    cleanup()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(guard.current).toBeNull()
  })

  it("does not double-fire when a fetch is already in flight for the same id", () => {
    const clock = makeFakeClock()
    const fetchSpy = vi.fn(async (_id: string) => fullPayload())
    const guard: UpgradeGuard = { current: null }

    scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })
    // The guard has now been claimed. A second scheduleUpgrade for the same id
    // must be a no-op.
    scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })

    clock.advance(UPGRADE_DELAY_MS * 5)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("schedules a single auto-retry when the upgrade response is still partial", async () => {
    const clock = makeFakeClock()
    let calls = 0
    const fetchSpy = vi.fn(async (_id: string) => {
      calls += 1
      // 1st call (upgrade) → still partial, 2nd (auto-retry) → full.
      return calls === 1 ? partialPayload() : fullPayload()
    })
    const setPayload = vi.fn()
    const guard: UpgradeGuard = { current: null }

    const cleanup = scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload, ...clock },
    })

    clock.advance(UPGRADE_DELAY_MS + 1)
    // The first call has fired. Wait for its microtask to resolve.
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(setPayload).toHaveBeenCalledWith("bitcoin", partialPayload())

    clock.advance(PARTIAL_AUTORETRY_MS + 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(setPayload).toHaveBeenLastCalledWith("bitcoin", fullPayload())

    cleanup()
  })

  it("does NOT auto-retry more than once per open", async () => {
    const clock = makeFakeClock()
    const fetchSpy = vi.fn(async (_id: string) => partialPayload())
    const guard: UpgradeGuard = { current: null }

    const cleanup = scheduleUpgrade({
      id: "bitcoin",
      isPartial: true,
      enabled: true,
      guard,
      deps: { fetch: fetchSpy as never, setPayload: () => {}, ...clock },
    })

    clock.advance(UPGRADE_DELAY_MS + 1)
    await Promise.resolve()
    await Promise.resolve()
    // Upgrade done, auto-retry scheduled.

    clock.advance(PARTIAL_AUTORETRY_MS + 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    // Another tick must NOT fire a third call.
    clock.advance(PARTIAL_AUTORETRY_MS * 5)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    cleanup()
  })
})
