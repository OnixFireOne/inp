// lib/asset-meta/bust-link-cache.ts
// Per-coin storefront cache invalidation. No global version bump and no SCAN:
// reconstruct the deterministic /api/links key (links:v{v}:t{tv}:{cg}) from
// the same helper used by the route, then delete exactly that one KV entry.
// See plan/link-templates-spec.md, sections "Аспект 4.5" and "Аспект 5.5".

import { kvDel } from "../kv"
import { getLinkCacheKey } from "../links/cache-key"

export async function bustLinkCaches(cg: string): Promise<void> {
  await kvDel(await getLinkCacheKey(cg))
}