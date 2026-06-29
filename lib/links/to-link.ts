// lib/links/to-link.ts
// Boundary mapper: resolver GeneratedLink -> storefront Link shape.
// See plan/link-templates-spec.md, section "Аспект 5.3".

import type { Link } from "../../types/asset"
import type { GeneratedLink } from "./resolve"

export function toLink(gl: GeneratedLink, assetId: string): Link {
  return {
    id: gl.id,
    asset_id: assetId,
    name: gl.label,
    description: undefined,
    href: gl.url,
    tier: gl.tier,
    category: gl.category,
    health: undefined,
    is_top: false,
    manual_rank: null,
    ai_score: null,
    icon: gl.icon ?? null,
    generated: true,
  }
}