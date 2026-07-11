// lib/links/templates-cache.ts
// Global cache of enabled link_templates. The version key comes from
// cache-key.ts, so /api/links and template invalidation agree on `tv`.

import { kvGet, kvSetEx } from "../kv"
import { supabaseServer } from "../supabase/server"
import { TEMPLATES_VERSION_KEY } from "./cache-key"
import type { LinkTemplate } from "./resolve"

const TTL = 60 * 60 // 1 hour; versioned key makes invalidation instant.

export async function getTemplateVersion(): Promise<number> {
  const raw = await kvGet<number>(TEMPLATES_VERSION_KEY)
  return typeof raw === "number" ? raw : 0
}

export async function getActiveTemplates(): Promise<LinkTemplate[]> {
  const tv = await getTemplateVersion()
  const cacheKey = `link_templates:active:v${tv}`
  const cached = await kvGet<LinkTemplate[]>(cacheKey)
  if (cached) return cached

  const supabase = await supabaseServer()
  const { data, error } = await supabase
    .from("link_templates")
    .select(
      "id, kind, category, label, icon, url_pattern, provider, source_key, chain_map, tier, sort, enabled",
    )
    .eq("enabled", true)
    .order("category", { ascending: true })
    .order("sort", { ascending: true })

  if (error) {
    console.warn("[links] failed to load link_templates", error.message)
    return []
  }
  // Supabase returns jsonb as a plain object (not a string). If a future
  // driver ever ships it as a string, normalise here.
  const templates = ((data ?? []) as Array<Omit<LinkTemplate, "chain_map"> & {
    chain_map: unknown
  }>).map((row) => ({
    ...row,
    chain_map:
      row.chain_map && typeof row.chain_map === "object"
        ? (row.chain_map as Record<string, string>)
        : null,
  }))
  await kvSetEx(cacheKey, TTL, templates)
  return templates
}