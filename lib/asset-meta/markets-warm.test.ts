// lib/asset-meta/markets-warm.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const kvMock = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
}))

vi.mock("../kv", () => ({
  kvGet: async <T>(key: string) =>
    kvMock.store.has(key) ? (kvMock.store.get(key) as T) : null,
  kvSetEx: async <T>(key: string, _ttl: number, value: T) => {
    kvMock.store.set(key, value as unknown)
  },
}))

import { warmMarketRow } from "./markets-warm"

beforeEach(() => {
  kvMock.store.clear()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("warmMarketRow", () => {
  it("returns cached single-id market row without fetching", async () => {
    kvMock.store.set("markets:ids:velvet", {
      rows: [
        {
          id: "velvet",
          rank: 123,
          name: "Velvet",
          symbol: "VELVET",
          image: "",
          price: 1,
          marketCap: 2,
          change24h: 3,
          sparkline: [],
        },
      ],
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const row = await warmMarketRow("velvet")

    expect(row?.symbol).toBe("VELVET")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches /coins/markets?ids=<id>, stores markets:ids:<id>, and returns row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            {
              id: "velvet",
              market_cap_rank: 321,
              name: "Velvet",
              symbol: "velvet",
              image: "https://img/velvet.png",
              current_price: 0.1,
              market_cap: 1000,
              price_change_percentage_24h: 1.2,
              price_change_percentage_30d_in_currency: 3.4,
              price_change_percentage_1y_in_currency: 5.6,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )

    const row = await warmMarketRow("velvet")

    expect(row).toMatchObject({ id: "velvet", symbol: "VELVET", rank: 321 })
    const cached = kvMock.store.get("markets:ids:velvet") as { rows: unknown[] }
    expect(cached.rows).toHaveLength(1)
  })

  it("returns null and does not cache when CG returns an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )

    const row = await warmMarketRow("ghost")

    expect(row).toBeNull()
    expect(kvMock.store.has("markets:ids:ghost")).toBe(false)
  })
})