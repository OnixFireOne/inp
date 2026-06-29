// lib/links/materialize.ts
// Pure helpers for freezing virtual GeneratedLink[] into curated `links` rows.

import { normalizeUrl } from "./source-registry"
import type { GeneratedLink } from "./resolve"
import { toLinkInsert, type LinkInsert } from "./to-link-insert"

export function buildMaterializeRows(
  generated: GeneratedLink[],
  existingHrefs: string[],
  assetId: string,
): LinkInsert[] {
  const have = new Set(existingHrefs.map((href) => normalizeUrl(href)))
  return generated
    .filter((g) => !have.has(normalizeUrl(g.url)))
    .map(toLinkInsert(assetId))
}