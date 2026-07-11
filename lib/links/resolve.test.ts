// lib/links/resolve.test.ts
// Unit tests for expandTemplates — strictly the cases listed in the spec's
// section "3.3. Юнит-тесты (минимум)".
// See plan/link-templates-spec.md, section "Аспект 3".

import { describe, expect, it } from "vitest"

import type { CgMeta } from "./providers/coingecko/types"
import { expandTemplates, type LinkTemplate } from "./resolve"
import type { AssetVars } from "./template-vars"

const SAMPLE_VARS: AssetVars = { coingecko_id: "bitcoin", ticker: "BTC" }

const PATTERN_COINGECKO: LinkTemplate = {
  id: "p1",
  kind: "pattern",
  category: "trade",
  label: "CoinGecko",
  icon: "🦎",
  url_pattern: "https://www.coingecko.com/en/coins/{slug}",
  tier: "Core",
  sort: 10,
  enabled: true,
}

const PATTERN_TV: LinkTemplate = {
  id: "p2",
  kind: "pattern",
  category: "trade",
  label: "TradingView",
  icon: "📈",
  url_pattern: "https://www.tradingview.com/symbols/{symbol}USD",
  tier: "Core",
  sort: 20,
  enabled: true,
}

const PROVIDER_HOMEPAGE: LinkTemplate = {
  id: "v1",
  kind: "provider",
  category: "site",
  label: "Сайт",
  icon: "🌐",
  provider: "coingecko",
  source_key: "homepage",
  tier: "Core",
  sort: 10,
  enabled: true,
}

const PROVIDER_TWITTER: LinkTemplate = {
  id: "v2",
  kind: "provider",
  category: "social",
  label: "X (Twitter)",
  icon: "🐦",
  provider: "coingecko",
  source_key: "twitter",
  tier: "Trusted",
  sort: 10,
  enabled: true,
}

const SAMPLE_META: CgMeta = {
  links: {
    homepage: ["https://bitcoin.org/", ""],
    twitter_screen_name: "bitcoin",
  },
}

describe("expandTemplates", () => {
  // Case 1: pattern {slug}/{symbol} substitute and get encoded
  it("substitutes {slug} and {symbol} in patterns", () => {
    const out = expandTemplates([PATTERN_COINGECKO, PATTERN_TV], SAMPLE_VARS, {})
    const urls = out.map((l) => l.url)
    expect(urls).toContain("https://www.coingecko.com/en/coins/bitcoin")
    expect(urls).toContain("https://www.tradingview.com/symbols/BTCUSD")
  })

  // Case 2: empty ticker → {symbol}-pattern is dropped (returns null → skipped)
  it("drops {symbol}-patterns when ticker is empty", () => {
    const out = expandTemplates(
      [PATTERN_COINGECKO, PATTERN_TV],
      { coingecko_id: "some-coin", ticker: "" },
      {},
    )
    const urls = out.map((l) => l.url)
    // {slug} survives, {symbol} is dropped → TradingView row omitted.
    expect(urls).toContain("https://www.coingecko.com/en/coins/some-coin")
    expect(urls).not.toContain("https://www.tradingview.com/symbols/USD")
  })

  // Case 3a: provider twitter handle → prefix
  it("turns twitter_screen_name into https://x.com/<handle>", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: { links: { twitter_screen_name: "bitcoin" } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe("https://x.com/bitcoin")
  })

  // Case 3b: already-URL → passthrough
  it("passes through pre-formatted twitter URL", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: {
        links: { twitter_screen_name: "https://x.com/already-formatted" },
      },
    })
    expect(out[0].url).toBe("https://x.com/already-formatted")
  })

  // Case 3c: leading @ stripped
  it("strips a leading @ from twitter handle", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: { links: { twitter_screen_name: "@bitcoin" } },
    })
    expect(out[0].url).toBe("https://x.com/bitcoin")
  })

  // Case 4: no provider snapshot → provider rows skipped, pattern rows kept
  it("skips provider rows when the snapshot is missing but keeps patterns", () => {
    const out = expandTemplates(
      [PATTERN_COINGECKO, PROVIDER_HOMEPAGE],
      SAMPLE_VARS,
      {}, // empty metaByProvider
    )
    const urls = out.map((l) => l.url)
    expect(urls).toContain("https://www.coingecko.com/en/coins/bitcoin")
    expect(urls).not.toContain("https://bitcoin.org")
  })

  // Case 5: enabled=false → row omitted
  it("omits disabled templates", () => {
    const out = expandTemplates(
      [{ ...PATTERN_COINGECKO, enabled: false }],
      SAMPLE_VARS,
      {},
    )
    expect(out).toHaveLength(0)
  })

  // Case 6: duplicate URL — winner is the lower _sort (in (category,_sort) order)
  it("dedupes by normalizeUrl keeping the first by (category, _sort)", () => {
    const dup1: LinkTemplate = {
      ...PROVIDER_HOMEPAGE,
      id: "dup-low",
      sort: 10,
      category: "site",
    }
    const dup2: LinkTemplate = {
      ...PROVIDER_HOMEPAGE,
      id: "dup-high",
      sort: 90,
      category: "site",
    }
    // Both resolve to the same normalized URL (trailing slash stripped).
    const out = expandTemplates([dup2, dup1], SAMPLE_VARS, {
      coingecko: { links: { homepage: ["https://bitcoin.org/"] } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("tpl:dup-low") // sort=10 wins over sort=90
    expect(out[0].url).toBe("https://bitcoin.org") // trailing slash stripped
  })

  // Case 7: {contract} pattern — picked from native chain, used {chain} slug from chain_map
  it("expands {contract}/{chain} patterns using the snapshot's native chain", () => {
    const dex: LinkTemplate = {
      id: "dex1",
      kind: "pattern",
      category: "dex",
      label: "DexScreener",
      icon: "📊",
      url_pattern: "https://dexscreener.com/{chain}/{contract}",
      chain_map: { ethereum: "ethereum", solana: "solana" },
      tier: "Core",
      sort: 10,
      enabled: true,
    }
    const out = expandTemplates([dex], SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "solana",
        links: {},
        detail_platforms: {
          solana: { contract_address: "SoLAddr", decimal_place: 9 },
          ethereum: { contract_address: "0xEth", decimal_place: 18 },
        },
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe("https://dexscreener.com/solana/SoLAddr")
  })

  // Case 8: {contract} pattern — unsupported chain in chain_map → row dropped
  it("drops {contract} patterns when the snapshot's chains are not in chain_map", () => {
    const dex: LinkTemplate = {
      id: "dex2",
      kind: "pattern",
      category: "dex",
      label: "DexScreener",
      icon: "📊",
      url_pattern: "https://dexscreener.com/{chain}/{contract}",
      chain_map: { ethereum: "ethereum" }, // no solana
      tier: "Core",
      sort: 10,
      enabled: true,
    }
    const out = expandTemplates([dex], SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "solana",
        links: {},
        detail_platforms: {
          solana: { contract_address: "SoL", decimal_place: 9 },
        },
      },
    })
    expect(out).toHaveLength(0)
  })

  // Case 9: empty template label → fallback derives from the URL hostname
  it("falls back to labelFromUrl when the template label is empty", () => {
    const explorer: LinkTemplate = {
      id: "expl1",
      kind: "provider",
      category: "explorer",
      label: "", // explorer rows are seeded with empty label
      icon: "🔎",
      provider: "coingecko",
      source_key: "explorer",
      tier: "Trusted",
      sort: 10,
      enabled: true,
    }
    const out = expandTemplates([explorer], SAMPLE_VARS, {
      coingecko: { links: { blockchain_site: ["https://blockchair.com/btc"] } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe("Blockchair")
  })

  // Case 10: empty pattern label with a {slug} template — still uses URL fallback
  it("falls back to labelFromUrl when the pattern label is empty", () => {
    const t: LinkTemplate = {
      id: "p10",
      kind: "pattern",
      category: "trade",
      label: "",
      url_pattern: "https://www.coingecko.com/en/coins/{slug}",
      tier: "Core",
      sort: 10,
      enabled: true,
    }
    const out = expandTemplates([t], SAMPLE_VARS, {})
    expect(out[0].label).toBe("Coingecko")
  })
})