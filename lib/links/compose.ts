// lib/links/compose.ts
// Pure payload composition for /api/links. It does NOT apply category order,
// fetch anything, or group Core/Trusted. The route keeps those concerns.
// See spec 3.1 and 5.1: curated wins; virtual links are used only when there
// are no curated links.

import type { Asset, Link } from "../../types/asset"
import { expandTemplates, type LinkTemplate } from "./resolve"
import type { AssetVars } from "./template-vars"
import { toLink } from "./to-link"

export type AssetStatus = "described" | "template" | "undescribed"

export type LinksPayload<TCategory> = {
  asset: Asset | null
  links: Link[]
  categories: TCategory[]
  generated: boolean
  status: AssetStatus
}

export function composeLinksPayload<TCategory>(args: {
  asset: (Asset & { status?: "described" | "template" | null }) | null
  assetId: string
  curated: Link[]
  categories: TCategory[]
  templates: LinkTemplate[]
  assetVars: AssetVars
  metaByProvider: Record<string, unknown>
}): LinksPayload<TCategory> {
  const status: AssetStatus = args.asset?.status ?? "undescribed"
  const hasCurated = args.curated.length > 0
  const links = hasCurated
    ? args.curated
    : expandTemplates(args.templates, args.assetVars, args.metaByProvider).map(
        (gl) => toLink(gl, args.assetId),
      )

  return {
    asset: args.asset,
    links,
    categories: args.categories,
    generated: !hasCurated,
    status,
  }
}