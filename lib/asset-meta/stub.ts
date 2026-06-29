// lib/asset-meta/stub.ts
// Idempotent minimal stub of the `assets` row required by the FK on
// asset_meta.asset_id. Aspect 4 only needs the id/coingecko_id/status
// triple; the rich name/ticker/icon backfill happens in the storefront
// route (Aspect 5).
// See plan/link-templates-spec.md, section "Аспект 4.2" + "Аспект 6.1".

import { supabaseServer } from "../supabase/server"

export async function ensureAssetStub(cg: string): Promise<void> {
  const supabase = await supabaseServer()
  // on conflict do nothing — never overwrite an existing described row.
  const { error } = await supabase
    .from("assets")
    .upsert(
      { id: cg, coingecko_id: cg, status: "template" },
      { onConflict: "id", ignoreDuplicates: true },
    )
  if (error) {
    // Don't throw — caller (ensureAssetMeta) treats errors as best-effort.
    // We log to the console so the admin can spot a broken FK / RLS.
    console.warn("[asset-meta] ensureAssetStub failed", cg, error.message)
  }
}