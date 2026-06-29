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
        const data = (await res.json()) as { result: string | null }
        if (data.result != null) {
          const parsed = JSON.parse(data.result) as T
          // Mirror to in-memory cache
          const ttl = 60_000 // default 60s if we don't know the TTL
          memCache.set(key, { data: parsed, expiresAt: Date.now() + ttl })
          return parsed
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

// Atomically set `value` at `key` only if the key is currently unset, with
// TTL `ttlSeconds`. Returns true if the write happened, false if the key
// already existed. Used for single-flight locks.
export async function kvSetNx<T>(
  key: string,
  ttlSeconds: number,
  value: T,
): Promise<boolean> {
  cleanup()
  const ttlMs = ttlSeconds * 1000
  const now = Date.now()

  // In-memory: best-effort atomic under the JS event loop (single-threaded).
  const existing = memCache.get(key) as CacheEntry<T> | undefined
  if (existing && existing.expiresAt > now) return false
  memCache.set(key, { data: value, expiresAt: now + ttlMs })

  // Upstash: real atomic SET ... NX EX. Conflict → undo the local write so
  // the two stores don't disagree.
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(
        `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(
          key,
        )}?NX=1&EX=${Math.max(1, Math.floor(ttlSeconds))}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(value),
          cache: "no-store",
        },
      )
      // Upstash returns "OK" on success and null when NX rejects.
      const raw = (await res.json()) as { result?: string | null }
      if (raw.result == null) {
        memCache.delete(key)
        return false
      }
    } catch {
      // Best-effort: if Upstash is unreachable we keep the local-only write
      // and report success — locks stay useful for stampede protection
      // even when KV is degraded.
    }
  }
  return true
}

// Atomic increment with TTL. Used for fixed-window rate limits.
// Upstash path is INCR + EXPIRE on the first hit; INCR is the global atomic
// primitive we need across serverless instances.
export async function kvIncrEx(
  key: string,
  ttlSeconds: number,
): Promise<number | null> {
  cleanup()

  const now = Date.now()
  const current = memCache.get(key) as CacheEntry<number> | undefined
  const next = current && current.expiresAt > now ? Number(current.data) + 1 : 1
  memCache.set(key, { data: next, expiresAt: now + ttlSeconds * 1000 })

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(
        `${process.env.KV_REST_API_URL}/incr/${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
          cache: "no-store",
        },
      )
      if (!res.ok) return null
      const raw = (await res.json()) as { result?: number | string | null }
      const n = Number(raw.result)
      if (!Number.isFinite(n)) return null
      if (n === 1) {
        await fetch(
          `${process.env.KV_REST_API_URL}/expire/${encodeURIComponent(
            key,
          )}/${Math.max(1, Math.floor(ttlSeconds))}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
            cache: "no-store",
          },
        )
      }
      memCache.set(key, { data: n, expiresAt: now + ttlSeconds * 1000 })
      return n
    } catch {
      return null
    }
  }

  return next
}

// Invalidate one key across both backends.
// Server-side only — the in-memory map lives in the Node process and can't
// be reached from the browser.
export async function kvDel(key: string): Promise<void> {
  memCache.delete(key)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(
        `${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
          cache: "no-store",
        }
      )
    } catch { /* best-effort */ }
  }
}
