import { describe, it, expect } from "vitest"
import { decideBodyView } from "./asset-body-view"

describe("decideBodyView", () => {
  it("returns 'skeleton' when showBodySkeleton is true (parent anti-flicker flag)", () => {
    expect(
      decideBodyView({
        showBodySkeleton: true,
        isLoading: false,
        partial: false,
        linksCount: 0,
        pendingCount: 0,
      })
    ).toBe("skeleton")
  })

  it("returns 'skeleton' while the first fetch is still in flight (no links yet)", () => {
    // This is the key bug guard: before this, EmptyState could flash
    // because links.length === 0 with isLoading=true.
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: true,
        partial: false,
        linksCount: 0,
        pendingCount: 0,
      })
    ).toBe("skeleton")
  })

  it("returns 'skeleton' even when showBodySkeleton is true AND partial is true (parent wins)", () => {
    expect(
      decideBodyView({
        showBodySkeleton: true,
        isLoading: false,
        partial: true,
        linksCount: 3,
        pendingCount: 0,
      })
    ).toBe("skeleton")
  })

  it("returns 'list' when a partial payload has at least one link", () => {
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: false,
        partial: true,
        linksCount: 1,
        pendingCount: 0,
      })
    ).toBe("list")
  })

  it("returns 'list' when a partial payload has pending rows but no resolved links", () => {
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: false,
        partial: true,
        linksCount: 0,
        pendingCount: 3,
      })
    ).toBe("list")
  })

  it("returns 'empty' only when the fetch completed cleanly with nothing", () => {
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: false,
        partial: false,
        linksCount: 0,
        pendingCount: 0,
      })
    ).toBe("empty")
  })

  it("returns 'list' when resolved links exist", () => {
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: false,
        partial: false,
        linksCount: 4,
        pendingCount: 0,
      })
    ).toBe("list")
  })

  it("returns 'list' when pending rows exist even without resolved links", () => {
    expect(
      decideBodyView({
        showBodySkeleton: false,
        isLoading: false,
        partial: false,
        linksCount: 0,
        pendingCount: 1,
      })
    ).toBe("list")
  })

  it("precedence order: showBodySkeleton > isLoading > partial > links/pending > empty", () => {
    // Sanity check on the ordering. Each row has a flag that would
    // push it to a different branch; only the highest-priority one
    // matters.
    const all: Array<Parameters<typeof decideBodyView>[0] & { expected: ReturnType<typeof decideBodyView> }> = [
      // showBodySkeleton wins over isLoading
      { showBodySkeleton: true, isLoading: true, partial: false, linksCount: 0, pendingCount: 0, expected: "skeleton" },
      // isLoading wins over partial + content
      { showBodySkeleton: false, isLoading: true, partial: true, linksCount: 5, pendingCount: 5, expected: "skeleton" },
      // partial wins over zero content
      { showBodySkeleton: false, isLoading: false, partial: true, linksCount: 0, pendingCount: 0, expected: "list" },
      // content wins over empty
      { showBodySkeleton: false, isLoading: false, partial: false, linksCount: 0, pendingCount: 1, expected: "list" },
      // nothing left → empty
      { showBodySkeleton: false, isLoading: false, partial: false, linksCount: 0, pendingCount: 0, expected: "empty" },
    ]
    for (const row of all) {
      const { expected, ...args } = row
      expect(decideBodyView(args)).toBe(expected)
    }
  })
})