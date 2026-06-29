// lib/asset-meta/rate-limit.test.ts
import { describe, expect, it } from "vitest"

import { tryConsume, windowIndexFor } from "./rate-limit"

class MemKv {
  store = new Map<string, number>()
  incrEx = async (k: string, _ttl: number) => {
    const next = (this.store.get(k) ?? 0) + 1
    this.store.set(k, next)
    return next
  }
}

describe("rate-limit / tryConsume", () => {
  it("allows exactly capacity requests in a window", async () => {
    const kv = new MemKv()
    const opts = {
      bucketKey: "test:b",
      capacity: 3,
      windowSeconds: 60,
      now: () => 60_000,
      kv: { incrEx: kv.incrEx },
    }
    expect(await tryConsume(opts)).toBe(true)
    expect(await tryConsume(opts)).toBe(true)
    expect(await tryConsume(opts)).toBe(true)
    expect(await tryConsume(opts)).toBe(false)
    expect(await tryConsume(opts)).toBe(false)
  })

  it("resets when crossing a window boundary", async () => {
    const kv = new MemKv()
    let t = 0
    const make = () => ({
      bucketKey: "test:b",
      capacity: 1,
      windowSeconds: 60,
      now: () => t,
      kv: { incrEx: kv.incrEx },
    })
    t = 1000
    expect(await tryConsume(make())).toBe(true)
    expect(await tryConsume(make())).toBe(false)
    t = 60_000 + 1000
    expect(await tryConsume(make())).toBe(true)
  })

  it("windowIndexFor maps seconds to bucket indices", () => {
    expect(windowIndexFor(0, 60)).toBe(0)
    expect(windowIndexFor(59_999, 60)).toBe(0)
    expect(windowIndexFor(60_000, 60)).toBe(1)
    expect(windowIndexFor(125_000, 60)).toBe(2)
  })

  it("treats KV errors as deny", async () => {
    const failing = {
      incrEx: async () => {
        throw new Error("boom")
      },
    }
    const out = await tryConsume({
      bucketKey: "x",
      capacity: 100,
      windowSeconds: 60,
      now: () => 0,
      kv: failing,
    })
    expect(out).toBe(false)
  })
})