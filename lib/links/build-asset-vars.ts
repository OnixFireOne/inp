// lib/links/build-asset-vars.ts
// Build variables consumed by pattern templates. Ticker comes from the DB asset
// when available; otherwise from the warmed /api/markets row. If missing,
// applyPattern drops {symbol} templates while {slug} templates still work.

import type { MarketRow } from "../types"
import type { AssetVars } from "./template-vars"

export type AssetVarsInput = {
  coingecko_id?: string | null
  ticker?: string | null
}

export function buildAssetVars(
  cg: string,
  asset: AssetVarsInput | null | undefined,
  marketRow: Pick<MarketRow, "symbol"> | null | undefined,
): AssetVars {
  return {
    coingecko_id: asset?.coingecko_id || cg,
    ticker: asset?.ticker || marketRow?.symbol || "",
  }
}