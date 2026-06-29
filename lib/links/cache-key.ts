// lib/links/cache-key.ts
// Single source of truth for /api/links storefront cache keys.
//
// v  = category/order version (link_categories + category_orders)
// tv = link_templates version (global template rows)
//
// Per-coin busts should delete exactly the reconstructed key below. Global
// mutations bump one of the version keys, making old payloads unreachable.

import { kvGet } from "../kv"

export const LINKS_VERSION_KEY = "links:cache_version"
export const TEMPLATES_VERSION_KEY = "link_templates:cache_version"

export type LinkCacheVersions = {
  v: number
  tv: number
}

export async function getLinkCacheVersions(): Promise<LinkCacheVersions> {
  const [vRaw, tvRaw] = await Promise.all([
    kvGet<number>(LINKS_VERSION_KEY),
    kvGet<number>(TEMPLATES_VERSION_KEY),
  ])
  return {
    v: typeof vRaw === "number" ? vRaw : 0,
    tv: typeof tvRaw === "number" ? tvRaw : 0,
  }
}

export function buildLinkCacheKey(
  cg: string,
  versions: LinkCacheVersions,
): string {
  return `links:v${versions.v}:t${versions.tv}:${cg}`
}

export async function getLinkCacheKey(cg: string): Promise<string> {
  return buildLinkCacheKey(cg, await getLinkCacheVersions())
}