// lib/asset-meta/markets-allowlist.ts
// Cheap rejection of nonsense CoinGecko ids before we burn budget on a fetch.
// Per spec 4.4: validate ids against already-known /api/markets data.
//
// Important: /api/markets is paginated and its KV keys are populated only by
// pages that users have actually requested (`markets:page:N`). There is no
// authoritative "all ids" key. Therefore we build an allowlist from warmed
// page caches only, plus already-warmed single-id lookups (`markets:ids:<id>`).
// We never make a live HTTP request from this module. Full miss => false.

import { kvGet } from "../kv"
import type { MarketRow, MarketsResponse } from "../types"

const PAGE_KEY = (page: number) => `markets:page:${page}`
const IDS_KEY = (id: string) => `markets:ids:${id}`
const MEMO_TTL_MS = 60_000
const MAX_PAGES_TO_SCAN = 50

type Memo = { rowsById: Map<string, MarketRow>; expiresAt: number }
let memo: Memo | null = null

export async function isAllowedCgId(
  id: string,
  opts?: { now?: number; kvGet?: typeof kvGet },
): Promise<boolean> {
  const row = await getMarketRowFromCache(id, opts)
  return !!row
}

/**
 * Return a warmed market row for `id`, if present in already-cached markets
 * pages or a warmed `markets:ids:<id>` lookup. Does not fetch live data.
 */
export async function getMarketRowFromCache(
  id: string,
  opts?: { now?: number; kvGet?: typeof kvGet },
): Promise<MarketRow | null> {
  if (!id) return null
  const now = (opts?.now ?? Date.now()) as number
  const read = opts?.kvGet ?? kvGet

  const cached = await getRowsById(now, read)
  const fromPages = cached.get(id)
  if (fromPages) return fromPages

  // Secondary positive cache only. This key is write-through and may not
  // exist for arbitrary ids, so absence must not open the gate.
  const byId = await read<{ rows: MarketRow[] }>(IDS_KEY(id))
  const hit = byId?.rows?.find((r) => r.id === id) ?? null
  return hit
}

async function getRowsById(
  now: number,
  read: typeof kvGet,
): Promise<Map<string, MarketRow>> {
  if (memo && memo.expiresAt > now) return memo.rowsById

  const rowsById = new Map<string, MarketRow>()

  // Read page 1 first. If it is cold, the allowlist is cold too: no live HTTP.
  const first = await read<MarketsResponse>(PAGE_KEY(1))
  if (!first || !Array.isArray(first.rows)) {
    memo = { rowsById, expiresAt: now + MEMO_TTL_MS }
    return rowsById
  }
  addRows(rowsById, first.rows)

  // Only known if page 1 is present. Read sequentially because `hasMore`
  // tells us whether the next page might exist; each page is a warmed cache
  // lookup, never a network call.
  let page = 2
  let hasMore = first.hasMore === true
  while (hasMore && page <= MAX_PAGES_TO_SCAN) {
    const payload = await read<MarketsResponse>(PAGE_KEY(page))
    if (!payload || !Array.isArray(payload.rows)) break
    addRows(rowsById, payload.rows)
    hasMore = payload.hasMore === true
    page += 1
  }

  memo = { rowsById, expiresAt: now + MEMO_TTL_MS }
  return rowsById
}

function addRows(rowsById: Map<string, MarketRow>, rows: MarketRow[]) {
  for (const r of rows) if (r.id) rowsById.set(r.id, r)
}

/** Test-only: clear the in-process memo. */
export function _resetAllowlistCache(): void {
  memo = null
}