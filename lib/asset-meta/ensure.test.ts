// lib/asset-meta/ensure.test.ts
// Integration-style tests for ensureAssetMeta's guard order. We mock
// supabase + kv + global fetch so the pipeline runs end-to-end without
// hitting any real backend.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ensureAssetMeta, __internal } from "./ensure"

const allowlistMocks = vi.hoisted(() => ({
  allowed: true,
  warmCalls: 0,
  warmResult: null as null | { id: string },
}))

vi.mock("../kv", () => {
  const store = new Map<string, unknown>()
  return {
    kvGet: async <T>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
    kvSetEx: async <T>(k: string, _ttl: number, v: T) => {
      store.set(k, v as unknown)
    },
    kvSetNx: async <T>(k: string, _ttl: number, v: T) => {
      if (store.has(k)) return false
      store.set(k, v as unknown)
      return true
    },
    kvIncrEx: async (k: string, _ttl: number) => {
      const next = Number(store.get(k) ?? 0) + 1
      store.set(k, next)
      return next
    },
    kvDel: async (k: string) => {
      store.delete(k)
    },
  }
})

// supabase stub. We only model the two tables ensureAssetMeta touches.
const selectResponses: Array<{ match: (sql: string) => boolean; value: any }> =
  []
const upsertCalls: Array<{ table: string; values: unknown }> = []
function queueSelect(value: any, match = () => true) {
  selectResponses.push({ match, value })
}
function drainSelects() {
  return selectResponses.splice(0, selectResponses.length)
}

const supabaseMock = {
  from: (table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        eq: (_col2: string, _val2: string) => ({
          maybeSingle: async () => {
            const q = drainSelects()
            const hit = q.find((r) => r.match(table))
            return { data: hit ? hit.value : null, error: null }
          },
        }),
      }),
    }),
    upsert: async (values: unknown, _opts: unknown) => {
      upsertCalls.push({ table, values })
      return { error: null }
    },
  }),
}

vi.mock("../supabase/server", () => ({
  supabaseServer: async () => supabaseMock,
}))

vi.mock("./markets-allowlist", () => ({
  isAllowedCgId: async (_id: string) => allowlistMocks.allowed,
  getMarketRowFromCache: async (_id: string) =>
    allowlistMocks.warmResult
      ? {
          id: allowlistMocks.warmResult.id,
          rank: 1,
          name: allowlistMocks.warmResult.id,
          symbol: allowlistMocks.warmResult.id.toUpperCase(),
          image: "",
          price: 1,
          marketCap: 1,
          change24h: 0,
          sparkline: [],
        }
      : null,
}))

vi.mock("./markets-warm", () => ({
  warmMarketRow: async (_id: string) => {
    allowlistMocks.warmCalls += 1
    return allowlistMocks.warmResult
  },
}))

vi.mock("./bust-link-cache", () => ({
  bustLinkCaches: async (_cg: string) => {},
}))

const RAW = { links: { homepage: ["https://bitcoin.org"] } }

beforeEach(() => {
  upsertCalls.length = 0
  drainSelects()
  allowlistMocks.allowed = true
  allowlistMocks.warmCalls = 0
  allowlistMocks.warmResult = null
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ensureAssetMeta", () => {
  it("fetches + trims + upserts when nothing is cached", async () => {
    queueSelect(null) // freshness check → none
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(RAW), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    )
    const out = await ensureAssetMeta("bitcoin", { wait: true })
    expect(out.status).toBe("fetched")
    // upsert order: assets stub first, then asset_meta.
    expect(upsertCalls.map((c) => c.table)).toEqual(["assets", "asset_meta"])
    expect((upsertCalls[0].values as { status: string }).status).toBe("template")
    expect((upsertCalls[1].values as { provider: string }).provider).toBe(
      "coingecko",
    )
  })

  it("warms a cold market row under the lock+budget before fetching snapshot", async () => {
    allowlistMocks.allowed = false
    allowlistMocks.warmResult = { id: "velvet" }
    queueSelect(null) // freshness check → none
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(RAW), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    )

    const out = await ensureAssetMeta("velvet", { wait: true })

    expect(out.status).toBe("fetched")
    expect(allowlistMocks.warmCalls).toBe(1)
    expect(upsertCalls.map((c) => c.table)).toEqual(["assets", "asset_meta"])
  })

  it("negative-caches a real cold market miss and does not create a stub", async () => {
    allowlistMocks.allowed = false
    allowlistMocks.warmResult = null
    queueSelect(null) // freshness check → none
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)

    const out = await ensureAssetMeta("ghost", { wait: true })

    expect(out.status).toBe("forbidden")
    expect(allowlistMocks.warmCalls).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(upsertCalls).toHaveLength(0)
  })

  it("returns 'fresh' when the DB row is younger than TTL", async () => {
    queueSelect({
      fetched_at: new Date(Date.now() - 60_000).toISOString(),
    })
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchSpy)
    const out = await ensureAssetMeta("bitcoin", { wait: true })
    expect(out.status).toBe("fresh")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(upsertCalls).toHaveLength(0)
  })

  it("force=true bypasses freshness", async () => {
    queueSelect({
      fetched_at: new Date(Date.now() - 60_000).toISOString(),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(RAW), { status: 200 }),
      ),
    )
    const out = await ensureAssetMeta("bitcoin", {
      wait: true,
      force: true,
    })
    expect(out.status).toBe("fetched")
    expect(upsertCalls.map((c) => c.table)).toEqual(["assets", "asset_meta"])
  })

  it("negative-caches a 404 from CG", async () => {
    queueSelect(null)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    )
    const out = await ensureAssetMeta("ghost", { wait: true })
    expect(out.status).toBe("negative_cached")
    expect(upsertCalls).toHaveLength(0)

    // Subsequent non-force call short-circuits on the neg-cache.
    const out2 = await ensureAssetMeta("ghost", { wait: true })
    expect(out2.status).toBe("negative_cached")

    // force=true bypasses neg-cache and re-hits CG.
    queueSelect(null)
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(RAW), { status: 200 }),
      ),
    )
    const out3 = await ensureAssetMeta("ghost", { wait: true, force: true })
    expect(out3.status).toBe("fetched")
  })

  it("wait=false returns immediately and resolves to 'skipped'", async () => {
    queueSelect(null)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    )
    const out = await ensureAssetMeta("bitcoin") // default wait=false
    expect(out.status).toBe("skipped")
    // give the background promise a tick to finish
    await new Promise((r) => setTimeout(r, 50))
    expect(upsertCalls.length).toBeGreaterThanOrEqual(2)
  })

  it("single-flight: second caller inside the lock window gets 'skipped'", async () => {
    queueSelect(null) // first freshness check
    // Simulate a long fetch by holding the response.
    let release: (v: Response) => void = () => {}
    const pending = new Promise<Response>((res) => {
      release = res
    })
    vi.stubGlobal("fetch", vi.fn(async () => pending))

    const a = ensureAssetMeta("bitcoin", { wait: true })
    // While a is awaiting the fetch, kick off a second call.
    const b = await ensureAssetMeta("bitcoin", { wait: true })
    expect(b.status).toBe("skipped")

    // Release the first call and confirm it completes successfully.
    release(new Response(JSON.stringify(RAW), { status: 200 }))
    const out = await a
    expect(out.status).toBe("fetched")
  })

  it("uses the env-derived TTL/limits", () => {
    expect(__internal.LOCK_TTL).toBe(30)
    expect(__internal.RATE_CAPACITY).toBeGreaterThan(0)
    expect(__internal.RATE_WINDOW).toBe(60)
  })
})
