// lib/links/source-registry-diagnostics.ts
// Helpers for the "available, but not added" editor panel (TЗ §7.5).
//
// (a) For a given provider, list SOURCE_REGISTRY keys whose resolve() returns
//     a URL against the supplied snapshot AND no enabled link_templates row
//     covers that (provider, source_key) → "добавить" with registry defaults.
//     Per-coin extension (replace sample with real snapshot) is intentionally
//     deferred until the editor gains a per-coin context — the panel still
//     works on a sample CgMeta and gives useful diagnostics.
// (b) Keys that exist in the snapshot but have no resolver in the registry —
//     this requires a snapshot. Marked as future work below.

import { SOURCE_REGISTRY, resolveSource } from "./source-registry"
import type { CgMeta } from "./providers/coingecko/types"
import type { LinkTemplate } from "./resolve"

export type AvailableSource = {
  provider: string
  sourceKey: string
  label: string
  icon: string
  category: string
  tier: "Core" | "Trusted"
  sample: string
  previewUrl: string
}

export function listAvailableSources(
  provider: string,
  templates: Pick<LinkTemplate, "provider" | "source_key" | "enabled">[],
  snapshot: CgMeta,
): AvailableSource[] {
  const covered = new Set(
    templates
      .filter((t) => t.enabled && t.provider === provider)
      .map((t) => `${t.provider}:${t.source_key}`),
  )
  const out: AvailableSource[] = []
  for (const def of Object.values(SOURCE_REGISTRY[provider] ?? {})) {
    const key = Object.keys(SOURCE_REGISTRY[provider]).find(
      (k) => SOURCE_REGISTRY[provider][k] === def,
    )
    if (!key) continue
    if (covered.has(`${provider}:${key}`)) continue
    const url = def.resolve(snapshot)
    if (!url) continue
    out.push({
      provider,
      sourceKey: key,
      label: def.defaultLabel,
      icon: def.defaultIcon,
      category: def.defaultCategory,
      tier: def.defaultTier,
      sample: def.sample,
      previewUrl: url,
    })
  }
  return out
}

/**
 * Future work (TЗ §7.5 (b)): list snapshot keys that have no resolver in the
 * registry. We accept any CgMeta-compatible object so it can be wired to a
 * real per-coin snapshot later without changing the call site.
 *
 * Implementation note: the CgMeta snapshot is intentionally narrow (see
 * providers/coingecko/types.ts), so this helper operates against the same
 * shape and only flags top-level `links.*` keys that aren't covered.
 */
export function listUnresolvedSnapshotKeys(snapshot: CgMeta): string[] {
  const known = new Set(Object.keys(SOURCE_REGISTRY.coingecko ?? {}))
  const out: string[] = []
  const linkKeys = (snapshot.links ?? {}) as Record<string, unknown>
  for (const k of Object.keys(linkKeys)) {
    if (!known.has(k)) out.push(k)
  }
  return out.sort()
}