// lib/kv.ts — cache wrapper with two backends behind one interface.
//
//   1. In-memory Map with TTL  — dev / VPS (Node). Always available.
//   2. Vercel/Upstash REST      — prod (set KV_REST_API_URL + KV_REST_API_TOKEN).
//
// Module-level Map lives for the process lifetime (survives HMR in dev).
// Keys: strings. Values: { data: T, expiresAt: number }.

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const memCache = new Map<string, CacheEntry<unknown>>()

// Cleanup expired entries periodically (cheap, runs on every kvGet/kvSet)
let lastCleanup = 0
function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < 30_000) return
  lastCleanup = now
  for (const [k, v] of memCache) {
    if (v.expiresAt <= now) memCache.delete(k)
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  cleanup()
  // 1. Try in-memory first
  const entry = memCache.get(key) as CacheEntry<T> | undefined
  if (entry && entry.expiresAt > Date.now()) return entry.data
  memCache.delete(key)

  // 2. Try Upstash if configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(
        `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }, cache: "no-store" }
      )
      if (res.ok) {
        const data = (await res.json()) as { result: T | null }
        if (data.result != null) {
          // Mirror to in-memory cache
          const ttl = 60_000 // default 60s if we don't know the TTL
          memCache.set(key, { data: data.result, expiresAt: Date.now() + ttl })
          return data.result
        }
      }
    } catch { /* best-effort */ }
  }
  return null
}

export async function kvSetEx<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
  cleanup()
  // 1. Always write in-memory
  memCache.set(key, { data: value, expiresAt: Date.now() + ttlSeconds * 1000 })

  // 2. Also write to Upstash if configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(
        `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}?EX=${Math.max(1, Math.floor(ttlSeconds))}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(value),
          cache: "no-store",
        }
      )
    } catch { /* best-effort */ }
  }
}
