// app/sitemap.ts
// Sitemap for SEO. Lists /asset/<coingecko_id> for every described asset
// (those with at least one published link).
//
// Asset URLs come from the described `assets` set in Supabase.
// Public read RLS already permits SELECT for anon.

import type { MetadataRoute } from "next"
import { supabaseServer } from "@/lib/supabase/server"
import { SITE_URL } from "@/lib/site"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL
  const supabase = await supabaseServer()

  const { data, error } = await supabase
    .from("assets")
    .select("coingecko_id, updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })

  if (error || !data) {
    // Fail-soft: return home only. Don't block builds because of SEO data.
    return [
      { url: `${baseUrl}/`, changeFrequency: "hourly", priority: 1.0 },
    ]
  }

  const assetEntries: MetadataRoute.Sitemap = data
    .filter((a) => typeof a.coingecko_id === "string" && a.coingecko_id.length > 0)
    .map((a) => ({
      url: `${baseUrl}/asset/${a.coingecko_id}`,
      lastModified: a.updated_at ?? undefined,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }))

  return [
    { url: `${baseUrl}/`, changeFrequency: "hourly", priority: 1.0 },
    ...assetEntries,
  ]
}
