// lib/asset-meta/stub.ts
// Idempotent stub of the `assets` row required by the FK on
// asset_meta.asset_id. `assets.name` is NOT NULL in production, so the stub
// must include display fields from the already-warmed market row when possible.
//
// on conflict do nothing — never overwrite an existing described row.
// See plan/link-templates-spec.md, sections "Аспект 4.2" + "Аспект 6.1".

import { getMarketRowFromCache } from "./markets-allowlist"
import type { MarketRow } from "../types"
import { supabaseServer } from "../supabase/server"

export async function ensureAssetStub(
  cg: string,
  marketRow?: MarketRow | null,
): Promise<void> {
  const supabase = await supabaseServer()
  const row = marketRow ?? (await getMarketRowFromCache(cg))

  const { error } = await supabase
    .from("assets")
    .upsert(
      {
        id: cg,
        coingecko_id: cg,
        status: "template",
        name: row?.name ?? cg,
        // Keep the fallback non-null so environments where ticker is NOT NULL
        // don't fail the FK precondition for asset_meta.
        ticker: row?.symbol ?? cg.toUpperCase(),
        icon: row?.image ?? null,
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
  if (error) {
    console.error("[asset-meta] ensureAssetStub failed", cg, error.message)
  }
}