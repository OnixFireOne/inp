// lib/links/provider-defaults.ts
// Editor-side helpers for kind='provider' templates. Reads from the SOURCE_REGISTRY
// the defaults the editor needs to prefill fields and to expose dropdowns.

import { SOURCE_REGISTRY } from "./source-registry"
import type { LinkTemplate } from "./resolve"

export type ProviderDefault = {
  label: string
  icon: string
  category: string
  tier: "Core" | "Trusted"
  sample: string
}

export function providerList(): string[] {
  return Object.keys(SOURCE_REGISTRY)
}

export function sourceKeyList(provider: string): string[] {
  return Object.keys(SOURCE_REGISTRY[provider] ?? {})
}

export function providerDefaults(
  provider: string,
  sourceKey: string,
): ProviderDefault | null {
  const def = SOURCE_REGISTRY[provider]?.[sourceKey]
  if (!def) return null
  return {
    label: def.defaultLabel,
    icon: def.defaultIcon,
    category: def.defaultCategory,
    tier: def.defaultTier,
    sample: def.sample,
  }
}

// Existing-row type guard for edit-mode prefill logic.
export function isProviderTemplate(
  t: Partial<LinkTemplate>,
): t is Partial<LinkTemplate> & { provider: string; source_key: string } {
  return t.kind === "provider" && !!t.provider && !!t.source_key
}