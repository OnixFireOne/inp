// lib/links/to-link-insert.ts
// Boundary mapper: resolver GeneratedLink -> database insert row for `links`.
// See plan/link-templates-spec.md, section "Аспект 6.2".

import type { GeneratedLink } from "./resolve"

export type LinkInsert = {
  asset_id: string
  name: string
  description: null
  href: string
  tier: "Core" | "Trusted"
  category: string
  icon: string | null
  is_top: false
  manual_rank: number
  health: null
}

export const toLinkInsert =
  (assetId: string) =>
  (g: GeneratedLink, i: number): LinkInsert => ({
    asset_id: assetId,
    name: g.label,
    description: null,
    href: g.url,
    tier: g.tier,
    category: g.category,
    icon: g.icon ?? null,
    is_top: false,
    manual_rank: (i + 1) * 10,
    health: null,
  })