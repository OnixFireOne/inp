// lib/links/contract-pattern.test.ts
import { describe, expect, it } from "vitest"

import type { CgMeta } from "./providers/coingecko/types"
import { expandContractPattern, isContractPattern } from "./contract-pattern"

const dexChainMap = {
  ethereum: "ethereum",
  "binance-smart-chain": "bsc",
  solana: "solana",
  base: "base",
}

const cgMetaWithNative = (native: string | null): CgMeta => ({
  asset_platform_id: native,
  links: {},
  detail_platforms: {
    ethereum: { contract_address: "0xNative", decimal_place: 18 },
    solana: { contract_address: "SoLNativeAddr", decimal_place: 9 },
    base: { contract_address: "  0xBaseAddr  ", decimal_place: 18 },
  },
})

describe("isContractPattern", () => {
  it("matches when {contract} is present", () => {
    expect(isContractPattern("https://dexscreener.com/{chain}/{contract}")).toBe(true)
    expect(isContractPattern("https://x.com/{chain}")).toBe(false)
    expect(isContractPattern(null)).toBe(false)
    expect(isContractPattern("")).toBe(false)
  })
})

describe("expandContractPattern", () => {
  it("prefers the native chain and substitutes both {chain} and {contract}", () => {
    const url = expandContractPattern(
      "https://dexscreener.com/{chain}/{contract}",
      dexChainMap,
      cgMetaWithNative("solana"),
    )
    expect(url).toBe("https://dexscreener.com/solana/SoLNativeAddr")
  })

  it("falls back to the first chain supported by chain_map when native is unsupported", () => {
    const url = expandContractPattern(
      "https://dexscreener.com/{chain}/{contract}",
      dexChainMap,
      cgMetaWithNative("polygon-pos"), // not in chainMap
    )
    // detail_platforms iteration order is insertion order; ethereum is first.
    expect(url).toBe("https://dexscreener.com/ethereum/0xNative")
  })

  it("uses the chain_map slug (NOT the CG key) for the target site", () => {
    // GMGN uses eth, not ethereum.
    const gmgnMap = { ethereum: "eth", solana: "sol" }
    const url = expandContractPattern(
      "https://gmgn.ai/{chain}/token/{contract}",
      gmgnMap,
      cgMetaWithNative("ethereum"),
    )
    expect(url).toBe("https://gmgn.ai/eth/token/0xNative")
  })

  it("trims whitespace around the contract address", () => {
    const url = expandContractPattern(
      "https://x/{chain}/{contract}",
      { base: "base" },
      cgMetaWithNative(null),
    )
    expect(url).toBe("https://x/base/0xBaseAddr")
  })

  it("returns undefined when detail_platforms is missing", () => {
    expect(
      expandContractPattern("https://x/{chain}/{contract}", dexChainMap, {
        asset_platform_id: "ethereum",
        links: {},
      }),
    ).toBeUndefined()
  })

  it("returns undefined when chain_map is empty", () => {
    expect(
      expandContractPattern("https://x/{chain}/{contract}", {}, cgMetaWithNative("ethereum")),
    ).toBeUndefined()
  })

  it("returns undefined when chain_map is null", () => {
    expect(
      expandContractPattern("https://x/{chain}/{contract}", null, cgMetaWithNative("ethereum")),
    ).toBeUndefined()
  })

  it("returns undefined when no chain in detail_platforms matches chain_map", () => {
    expect(
      expandContractPattern(
        "https://x/{chain}/{contract}",
        { ethereum: "ethereum" },
        {
          asset_platform_id: "polygon-pos",
          links: {},
          detail_platforms: {
            "polygon-pos": { contract_address: "0xPoly", decimal_place: 18 },
          },
        },
      ),
    ).toBeUndefined()
  })

  it("returns undefined when the CG snapshot is missing entirely", () => {
    expect(
      expandContractPattern("https://x/{chain}/{contract}", dexChainMap, undefined),
    ).toBeUndefined()
  })

  it("handles missing asset_platform_id by going straight to the fallback loop", () => {
    const m: CgMeta = {
      asset_platform_id: null,
      links: {},
      detail_platforms: {
        base: { contract_address: "0xB", decimal_place: 18 },
      },
    }
    const url = expandContractPattern(
      "https://x/{chain}/{contract}",
      { base: "base" },
      m,
    )
    expect(url).toBe("https://x/base/0xB")
  })
})