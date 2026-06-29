// lib/asset-meta/stub.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; values: any; opts: unknown }>,
  cachedRow: null as any,
}))

vi.mock("../supabase/server", () => ({
  supabaseServer: async () => ({
    from: (table: string) => ({
      upsert: async (values: any, opts: unknown) => {
        calls.upserts.push({ table, values, opts })
        return { error: null }
      },
    }),
  }),
}))

vi.mock("./markets-allowlist", () => ({
  getMarketRowFromCache: async (_id: string) => calls.cachedRow,
}))

import { ensureAssetStub } from "./stub"

beforeEach(() => {
  calls.upserts.length = 0
  calls.cachedRow = null
})

describe("ensureAssetStub", () => {
  it("writes name, ticker and icon from the explicit market row", async () => {
    await ensureAssetStub("unibase", {
      id: "unibase",
      rank: 1,
      name: "Unibase",
      symbol: "UB",
      image: "https://img/unibase.png",
      price: 1,
      marketCap: 100,
      change24h: 0,
      sparkline: [],
    })

    expect(calls.upserts).toHaveLength(1)
    expect(calls.upserts[0].values).toMatchObject({
      id: "unibase",
      coingecko_id: "unibase",
      status: "template",
      name: "Unibase",
      ticker: "UB",
      icon: "https://img/unibase.png",
    })
    expect(calls.upserts[0].opts).toMatchObject({
      onConflict: "id",
      ignoreDuplicates: true,
    })
  })

  it("falls back to the warmed cache row when no explicit row is passed", async () => {
    calls.cachedRow = {
      id: "velvet",
      rank: 2,
      name: "Velvet",
      symbol: "VELVET",
      image: "https://img/velvet.png",
      price: 1,
      marketCap: 100,
      change24h: 0,
      sparkline: [],
    }

    await ensureAssetStub("velvet")

    expect(calls.upserts[0].values).toMatchObject({
      name: "Velvet",
      ticker: "VELVET",
      icon: "https://img/velvet.png",
    })
  })

  it("keeps NOT NULL columns safe without a market row", async () => {
    await ensureAssetStub("ghost")

    expect(calls.upserts[0].values).toMatchObject({
      id: "ghost",
      name: "ghost",
      ticker: "GHOST",
      icon: null,
    })
  })
})