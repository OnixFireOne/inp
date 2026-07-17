// lib/links/compose.ts
// Pure payload composition for /api/links. It does NOT apply category order,
// fetch anything, or group Core/Trusted. The route keeps those concerns.
// See spec 3.1 and 5.1: curated wins; virtual links are used only when there
// are no curated links.
//
// PARTIAL SEMANTICS — applies to BOTH the prefetch path and the click path:
//   A payload is `partial: true` whenever the probe classifies some enabled
//   template as `pending-meta` (see lib/links/resolve.ts → tryResolveTemplate).
//   That happens on:
//     - Prefetch path: ensure was never run, so cold coins naturally have
//       pending slots that shimmer while the user is hovering.
//     - Click path: ensure ran but timed out (5s inline) without producing
//       a snapshot. The 60s KV TTL handles the network side; we MUST also
//       mark the response partial so the client triggers an upgrade fetch
//       on the NEXT open. Otherwise "opened → ensure timeout → close →
//       reopen" would lock the user into a degraded view with no shimmer,
//       no upgrade, and no Retry — until the 12h RQ staleTime expires.
//   Both paths share the same client code (DrawerBody upgrade + Retry
//   footer), so emitting partial unconditionally on either path keeps a
//   single rendering pipeline. The route's `?prefetch=1` flag is now only
//   used to decide whether to RUN ensure; the payload shape itself is the
//   same.

import type { Asset, Link } from "../../types/asset"
import { expandTemplates, countPendingTemplates, type LinkTemplate } from "./resolve"
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
  /** Kept for back-compat with existing callers. Previously gated whether
   *  partial/pending fields could be emitted; now ignored — both fields
   *  are always derived from `countPendingTemplates`, which the caller
   *  gets for free. New callers can omit the flag entirely. */
  allowPartial?: boolean
}): LinksPayload<TCategory> & {
  /** True when some enabled template was classified as `pending-meta` —
   *  i.e. its URL would resolve once `metaByProvider` is populated. The
   *  client renders shimmer slots for these and (on the click path) fires
   *  a fresh /api/links to upgrade. */
  partial?: boolean
  /** Per-category reserved shimmer slot counts. */
  pending?: { categoryKey: string; count: number }[]
  /** True if at least one kind=provider template is pending on meta. */
  hasProviderPending?: boolean
  /** True if any {contract} pattern template is pending on meta. */
  hasContractPending?: boolean
} {
  const status: AssetStatus = args.asset?.status ?? "undescribed"
  const hasCurated = args.curated.length > 0
  const links = hasCurated
    ? args.curated
    : expandTemplates(args.templates, args.assetVars, args.metaByProvider).map(
        (gl) => toLink(gl, args.assetId),
      )

  const result: LinksPayload<TCategory> & {
    partial?: boolean
    pending?: { categoryKey: string; count: number }[]
    hasProviderPending?: boolean
    hasContractPending?: boolean
  } = {
    asset: args.asset,
    links,
    categories: args.categories,
    generated: !hasCurated,
    status,
  }

  // Pending templates only matter on the generated-link path for assets
  // eligible for metadata ensure. Curated and described assets never use
  // those templates (and route.ts deliberately never ensures them), so
  // probing them would create a permanent partial payload and needless
  // drawer upgrades.
  const canEnsureMeta =
    (!args.asset || args.asset.status === "template") && !hasCurated
  if (!canEnsureMeta) return result

  // Single source of truth for "is this payload partial?" — the same
  // probe used by expandTemplates (via tryResolveTemplate). If something
  // would render once meta arrives, we mark the payload partial so the
  // client knows to upgrade. This works identically for the prefetch
  // path (no ensure run) and the click path (ensure timeout).
  const pendingInfo = countPendingTemplates(
    args.templates,
    args.assetVars,
    args.metaByProvider,
  )
  const hasPendingWork =
    pendingInfo.hasProviderPending ||
    pendingInfo.hasContractPending ||
    Object.keys(pendingInfo.byCategory).length > 0

  if (!hasPendingWork) return result

  result.partial = true
  result.hasProviderPending = pendingInfo.hasProviderPending
  result.hasContractPending = pendingInfo.hasContractPending
  result.pending = Object.entries(pendingInfo.byCategory).map(
    ([categoryKey, count]) => ({ categoryKey, count }),
  )
  return result
}