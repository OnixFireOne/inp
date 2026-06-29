// lib/links/backfill-asset.ts
// Best-effort enrichment of the minimal assets stub created by ensureAssetMeta.
// Aspect 4 creates only { id, coingecko_id, status='template' } to satisfy the
// asset_meta FK. In /api/links we can cheaply fill name/ticker/icon from the
// already-warmed /api/markets cache, without blocking render and without
// overwriting curated data.

import type { Asset } from "../../types/asset"
import type { MarketRow } from "../types"
import { supabaseServer } from "../supabase/server"

export type BackfillableAsset = {
  id: string
  name?: string | null
  ticker?: string | null
  icon?: string | null
}

export function maybeBackfillAssetFromMarket(
  asset: BackfillableAsset | null | undefined,
  marketRow: MarketRow | null | undefined,
): void {
  if (!asset || !marketRow) return
  void backfillAssetFromMarket(asset, marketRow).catch((e) => {
    console.warn("[links] asset backfill failed", asset.id, String(e))
  })
}

export async function backfillAssetFromMarket(
  asset: BackfillableAsset | null | undefined,
  marketRow: MarketRow | null | undefined,
): Promise<boolean> {
  if (!asset || !marketRow) return false
  const patch = buildBackfillPatch(asset, marketRow)
  if (!patch) return false
  await runBackfill(asset.id, patch)
  return true
}

export function buildBackfillPatch(
  asset: BackfillableAsset,
  marketRow: MarketRow,
): Partial<Pick<Asset, "name" | "ticker" | "icon">> | null {
  const patch: Partial<Pick<Asset, "name" | "ticker" | "icon">> = {}
  if (!asset.name && marketRow.name) patch.name = marketRow.name
  if (!asset.ticker && marketRow.symbol) patch.ticker = marketRow.symbol
  if (!asset.icon && marketRow.image) patch.icon = marketRow.image
  return Object.keys(patch).length ? patch : null
}

async function runBackfill(
  assetId: string,
  patch: Partial<Pick<Asset, "name" | "ticker" | "icon">>,
): Promise<void> {
  const supabase = await supabaseServer()
  const { error } = await supabase
    .from("assets")
    .update(patch)
    .eq("id", assetId)
    // Never overwrite data added between read and background update.
    .or(
      [
        "name.is.null",
        "name.eq.",
        "ticker.is.null",
        "ticker.eq.",
        "icon.is.null",
        "icon.eq.",
      ].join(","),
    )
  if (error) throw new Error(error.message)
}