// lib/links/dnd-rank.test.ts
import { describe, expect, it } from "vitest"

import {
  computeNextSortForCategory,
  rerankWithinCategory,
  rerankWithinScope,
} from "./dnd-rank"

type Cat = { id: string; category: string; sort: number }
type Scoped = { id: string; scope: string; sort: number; extra?: string }

describe("rerankWithinCategory", () => {
  it("rewrites sort as 10, 20, 30... per category bucket", () => {
    const rows: Cat[] = [
      { id: "a", category: "trade", sort: 999 },
      { id: "b", category: "social", sort: 999 },
      { id: "c", category: "trade", sort: 999 },
    ]
    const out = rerankWithinCategory(rows)
    expect(out.find((r) => r.id === "a")?.sort).toBe(10)
    expect(out.find((r) => r.id === "c")?.sort).toBe(20)
    expect(out.find((r) => r.id === "b")?.sort).toBe(10)
  })
})

describe("rerankWithinScope", () => {
  it("rewrites sort as 10, 20, 30... per scope bucket and preserves other fields", () => {
    const rows: Scoped[] = [
      { id: "g1", scope: "global", sort: 999, extra: "x" },
      { id: "p1", scope: "per-coin-abc", sort: 999, extra: "y" },
      { id: "g2", scope: "global", sort: 999, extra: "z" },
    ]
    const out = rerankWithinScope<Scoped>(rows, "scope")
    const byId = new Map(out.map((r) => [r.id, r]))
    expect(byId.get("g1")?.sort).toBe(10)
    expect(byId.get("g2")?.sort).toBe(20)
    expect(byId.get("p1")?.sort).toBe(10)
    // Other fields preserved.
    expect(byId.get("g1")?.extra).toBe("x")
    expect(byId.get("p1")?.extra).toBe("y")
  })
})

describe("computeNextSortForCategory", () => {
  it("returns max+10 within the category, or 10 when empty", () => {
    expect(
      computeNextSortForCategory(
        [
          { category: "trade", sort: 30 },
          { category: "social", sort: 5 },
          { category: "trade", sort: 10 },
        ],
        "trade",
      ),
    ).toBe(40)
    expect(computeNextSortForCategory([], "trade")).toBe(10)
  })
})