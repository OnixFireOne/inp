// lib/links/build-asset-vars.test.ts
import { describe, expect, it } from "vitest"

import { buildAssetVars } from "./build-asset-vars"

describe("buildAssetVars", () => {
  it("uses asset ticker before market row symbol", () => {
    expect(
      buildAssetVars(
        "bitcoin",
        { coingecko_id: "btc-id", ticker: "BTC" },
        { symbol: "XBT" },
      ),
    ).toEqual({ coingecko_id: "btc-id", ticker: "BTC" })
  })

  it("uses market row symbol when asset ticker is missing", () => {
    expect(buildAssetVars("coin", { coingecko_id: "coin", ticker: "" }, { symbol: "COIN" })).toEqual({
      coingecko_id: "coin",
      ticker: "COIN",
    })
  })

  it("keeps ticker empty when no source has it", () => {
    expect(buildAssetVars("coin", null, null)).toEqual({
      coingecko_id: "coin",
      ticker: "",
    })
  })
})