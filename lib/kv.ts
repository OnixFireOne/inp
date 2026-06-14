// lib/kv.ts — in-memory KV for Phase 2 dev (replace with Upstash/ioredis in prod)
const store = new Map<string, { value: any; expires: number }>()

export async function kvGet<T>(key: string): Promise<T | null> {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) {
    store.delete(key)
    return null
  }
  return hit.value as T
}

export async function kvSetEx<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
  const expires = Date.now() + ttlSeconds * 1000
  store.set(key, { value, expires })
}
