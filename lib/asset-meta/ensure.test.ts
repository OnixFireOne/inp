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
// The select responses can come from either a queued list (drained in
// order) or a dynamic provider function (called per request) — useful
// when a test wants to switch the answer mid-flight (e.g. polling for a
// snapshot that another caller is still upserting).
type SelectResponse = { match?: (sql: string) => boolean; value: any }
type SelectProvider = () => any
const selectResponses: SelectResponse[] = []
let selectProvider: SelectProvider | null = null
const upsertCalls: Array<{ table: string; values: unknown }> = []
function queueSelect(value: any, match = () => true) {
  selectResponses.push({ match, value })
}
function setSelectProvider(fn: SelectProvider | null) {
  selectProvider = fn
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
            if (selectProvider) {
              return { data: selectProvider(), error: null }
            }
            const q = drainSelects()
            const hit = q.find((r) => r.match!(table))
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
  selectProvider = null
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

  it("single-flight: second caller inside the lock window WAITS for the first to finish", async () => {
    // Two callers racing on the same cold coin must NOT both end up with a
    // stale/empty payload. The second caller polls the DB and observes the
    // snapshot that the first caller is upserting, then returns "fetched"
    // (no fresh data, but the inline caller will re-read meta anyway and
    // find it present — that's the route's job, not ours).
    let snapshotUpserted = false
    setSelectProvider(() => {
      // While the first caller is still in flight we report "not fresh";
      // once its upsert lands, every subsequent poll sees a fresh row.
      if (!snapshotUpserted) return null
      return { fetched_at: new Date(Date.now() - 1000).toISOString() }
    })
    upsertCalls.length = 0

    let release: (v: Response) => void = () => {}
    const pending = new Promise<Response>((res) => {
      release = res
    })
    vi.stubGlobal("fetch", vi.fn(async () => pending))

    const a = ensureAssetMeta("bitcoin", { wait: true })
    // While a is awaiting the fetch, kick off a second call.
    const b = ensureAssetMeta("bitcoin", { wait: true })

    // Give b a tick to enter waitForSnapshotUnderLock.
    await new Promise((r) => setTimeout(r, 50))

    // Release the first call so it upserts and frees the lock.
    release(new Response(JSON.stringify(RAW), { status: 200 }))
    const out = await a
    // Mark the snapshot as upserted AFTER a finishes, mirroring production
    // timing (the upsert inside doEnsure writes before kvDel frees the lock).
    snapshotUpserted = true
    expect(out.status).toBe("fetched")

    // b should observe the now-fresh snapshot via the polling path.
    const outB = await b
    expect(outB.status).toBe("fetched")

    setSelectProvider(null)
  })

  it("single-flight: second caller times out and reports 'skipped' when lock holder never produces a snapshot", async () => {
    // Edge case: lock holder fails before upserting. The waiter must NOT
    // hang — it returns 'skipped' after its internal deadline, and the
    // route's outer timeout (ENSURE_INLINE_TIMEOUT_MS) bounds the user-
    // facing wait further.
    setSelectProvider(() => null)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server down", { status: 500 })),
    )

    const a = ensureAssetMeta("bitcoin", { wait: true })
    const b = ensureAssetMeta("bitcoin", { wait: true })

    const [outA, outB] = await Promise.all([a, b])
    // The first caller hits fetch failure and treats it as rate_limited
    // (existing behaviour). The second waiter times out → 'skipped'.
    expect(outA.status).toBe("rate_limited")
    expect(outB.status).toBe("skipped")

    setSelectProvider(null)
  })

  it("uses the env-derived TTL/limits", () => {
    expect(__internal.LOCK_TTL).toBe(30)
    expect(__internal.RATE_CAPACITY).toBeGreaterThan(0)
    expect(__internal.RATE_WINDOW).toBe(60)
  })
})
