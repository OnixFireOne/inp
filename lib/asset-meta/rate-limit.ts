// lib/asset-meta/rate-limit.ts
// Global request budget for CoinGecko /coins/{id}.
//
// Decision (Aspect 4 review): the counter lives in KV, NOT process memory.
// On Vercel / Upstash the budget must hold across many isolated serverless
// instances — a per-process counter would multiply the real limit.
//
// Algorithm: fixed-window counter via atomic KV INCR + EXPIRE. Window key =
// `<bucketKey>:<windowIndex>`, where the index is `floor(now / windowSeconds)`.
// The key auto-evicts when its TTL runs out.
//
// Trade-off: at window boundary you can briefly see up to 2*capacity in
// `windowSeconds`. That's acceptable for protecting a free-tier 30/min quota;
// a smooth token bucket needs Lua/transactions, which this KV wrapper avoids.

import { kvIncrEx } from "../kv"

export type RateLimitKv = {
  incrEx: (k: string, ttl: number) => Promise<number | null>
}

export type RateLimitOpts = {
  /** KV key prefix, e.g. "cg:budget:coingecko". */
  bucketKey: string
  /** Max requests allowed within one window. */
  capacity: number
  /** Window length in seconds. */
  windowSeconds: number
  /** Current epoch millis (injectable for tests). Defaults to Date.now. */
  now?: () => number
  /** KV layer (injectable for tests). Defaults to real kvIncrEx. */
  kv?: RateLimitKv
}

/** Pure window index from now (seconds). */
export function windowIndexFor(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds)
}

const defaultKv: RateLimitKv = {
  incrEx: kvIncrEx,
}

/**
 * Try to consume one token from the bucket.
 * Returns true if the atomic counter remains within capacity.
 */
export async function tryConsume(opts: RateLimitOpts): Promise<boolean> {
  const { bucketKey, capacity, windowSeconds } = opts
  const now = (opts.now ?? (() => Date.now()))()
  const kv = opts.kv ?? defaultKv
  const window = windowIndexFor(now, windowSeconds)
  const key = `${bucketKey}:${window}`

  try {
    const count = await kv.incrEx(key, windowSeconds + 1)
    return typeof count === "number" && count <= capacity
  } catch {
    // Deny on KV failure so we don't accidentally lift the global limit.
    return false
  }
}