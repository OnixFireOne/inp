// lib/asset-meta/markets-allowlist.test.ts
import { beforeEach, describe, expect, it } from "vitest"

import { _resetAllowlistCache, getMarketRowFromCache, isAllowedCgId } from "./markets-allowlist"
import type { MarketsResponse } from "../types"

const row = (id: string, symbol = id.toUpperCase()) => ({
  id,
  rank: 1,
  name: id,
  symbol,
  image: "",
  price: 1,
  marketCap: 1,
  change24h: 0,
  sparkline: [],
})

beforeEach(() => _resetAllowlistCache())

describe("markets allowlist", () => {
  it("finds ids on warmed pages beyond page 1", async () => {
    const store = new Map<string, MarketsResponse>([
      ["markets:page:1", { rows: [row("bitcoin")], page: 1, perPage: 1, hasMore: true }],
      ["markets:page:2", { rows: [row("ethereum")], page: 2, perPage: 1, hasMore: true }],
      ["markets:page:3", { rows: [row("solana")], page: 3, perPage: 1, hasMore: false }],
    ])
    const kvGet = async <T>(k: string) => (store.get(k) as T | undefined) ?? null
    await expect(isAllowedCgId("solana", { kvGet, now: 0 })).resolves.toBe(true)
    await expect(getMarketRowFromCache("ethereum", { kvGet, now: 0 })).resolves.toMatchObject({ symbol: "ETHEREUM" })
  })

  it("falls back only to already-warmed markets:ids:<id>", async () => {
    const store = new Map<string, unknown>([
      ["markets:ids:pepe", { rows: [row("pepe", "PEPE")] }],
    ])
    const kvGet = async <T>(k: string) => (store.get(k) as T | undefined) ?? null
    await expect(isAllowedCgId("pepe", { kvGet, now: 0 })).resolves.toBe(true)
    await expect(getMarketRowFromCache("pepe", { kvGet, now: 0 })).resolves.toMatchObject({ symbol: "PEPE" })
  })

  it("returns false on a cold allowlist and does not open the gate", async () => {
    const kvGet = async <T>(_k: string) => null as T | null
    await expect(isAllowedCgId("unknown", { kvGet, now: 0 })).resolves.toBe(false)
  })
})