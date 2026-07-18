// lib/links/resolve.test.ts — extended for countPendingTemplates.
// Pure resolver unit tests per spec section "3.3. Юнит-тесты (минимум)"
// + dedicated tests for the pending-count helper used by the prefetch path.
import { describe, expect, it } from "vitest"

import type { CgMeta } from "./providers/coingecko/types"
import {
  countPendingTemplates,
  expandTemplates,
  tryResolveTemplate,
  type LinkTemplate,
} from "./resolve"
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

const PATTERN_DEX: LinkTemplate = {
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

const SAMPLE_META: CgMeta = {
  links: {
    homepage: ["https://bitcoin.org/", ""],
    twitter_screen_name: "bitcoin",
  },
}

describe("expandTemplates", () => {
  it("substitutes {slug} and {symbol} in patterns", () => {
    const out = expandTemplates([PATTERN_COINGECKO, PATTERN_TV], SAMPLE_VARS, {})
    const urls = out.map((l) => l.url)
    expect(urls).toContain("https://www.coingecko.com/en/coins/bitcoin")
    expect(urls).toContain("https://www.tradingview.com/symbols/BTCUSD")
  })

  it("drops {symbol}-patterns when ticker is empty", () => {
    const out = expandTemplates(
      [PATTERN_COINGECKO, PATTERN_TV],
      { coingecko_id: "some-coin", ticker: "" },
      {},
    )
    const urls = out.map((l) => l.url)
    expect(urls).toContain("https://www.coingecko.com/en/coins/some-coin")
    expect(urls).not.toContain("https://www.tradingview.com/symbols/USD")
  })

  it("turns twitter_screen_name into https://x.com/<handle>", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: { links: { twitter_screen_name: "bitcoin" } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe("https://x.com/bitcoin")
  })

  it("passes through pre-formatted twitter URL", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: {
        links: { twitter_screen_name: "https://x.com/already-formatted" },
      },
    })
    expect(out[0].url).toBe("https://x.com/already-formatted")
  })

  it("strips a leading @ from twitter handle", () => {
    const out = expandTemplates([PROVIDER_TWITTER], SAMPLE_VARS, {
      coingecko: { links: { twitter_screen_name: "@bitcoin" } },
    })
    expect(out[0].url).toBe("https://x.com/bitcoin")
  })

  it("skips provider rows when the snapshot is missing but keeps patterns", () => {
    const out = expandTemplates(
      [PATTERN_COINGECKO, PROVIDER_HOMEPAGE],
      SAMPLE_VARS,
      {},
    )
    const urls = out.map((l) => l.url)
    expect(urls).toContain("https://www.coingecko.com/en/coins/bitcoin")
    expect(urls).not.toContain("https://bitcoin.org")
  })

  it("omits disabled templates", () => {
    const out = expandTemplates(
      [{ ...PATTERN_COINGECKO, enabled: false }],
      SAMPLE_VARS,
      {},
    )
    expect(out).toHaveLength(0)
  })

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
    const out = expandTemplates([dup2, dup1], SAMPLE_VARS, {
      coingecko: { links: { homepage: ["https://bitcoin.org/"] } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("tpl:dup-low")
    expect(out[0].url).toBe("https://bitcoin.org")
  })

  it("expands {contract}/{chain} patterns using the snapshot's native chain", () => {
    const out = expandTemplates([PATTERN_DEX], SAMPLE_VARS, {
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

  it("drops {contract} patterns when the snapshot's chains are not in chain_map", () => {
    const dex: LinkTemplate = {
      ...PATTERN_DEX,
      chain_map: { ethereum: "ethereum" },
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

  it("falls back to labelFromUrl when the template label is empty (provider)", () => {
    const explorer: LinkTemplate = {
      id: "expl1",
      kind: "provider",
      category: "explorer",
      label: "",
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
    expect(out[0].label).toBe("Blockchair")
  })

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

describe("countPendingTemplates", () => {
  it("counts provider templates whose meta is missing, grouped by category", () => {
    const out = countPendingTemplates(
      [PROVIDER_HOMEPAGE, PROVIDER_TWITTER],
      SAMPLE_VARS,
      {}, // no coingecko meta
    )
    expect(out.byCategory["site"]).toBe(1)
    expect(out.byCategory["social"]).toBe(1)
    expect(out.hasProviderPending).toBe(true)
    expect(out.hasContractPending).toBe(false)
  })

  it("does NOT count {slug}/{symbol}-only patterns as pending", () => {
    const out = countPendingTemplates(
      [PATTERN_COINGECKO, PATTERN_TV],
      SAMPLE_VARS,
      {},
    )
    expect(Object.keys(out.byCategory)).toHaveLength(0)
    expect(out.hasProviderPending).toBe(false)
    expect(out.hasContractPending).toBe(false)
  })

  it("counts {contract} patterns as pending when meta is absent", () => {
    const out = countPendingTemplates([PATTERN_DEX], SAMPLE_VARS, {})
    expect(out.byCategory["dex"]).toBe(1)
    expect(out.hasContractPending).toBe(true)
  })

  it("does NOT count {contract} patterns when meta exists AND chain maps", () => {
    const out = countPendingTemplates([PATTERN_DEX], SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "ethereum",
        links: {},
        detail_platforms: {
          ethereum: { contract_address: "0xEth", decimal_place: 18 },
        },
      },
    })
    expect(Object.keys(out.byCategory)).toHaveLength(0)
    expect(out.hasContractPending).toBe(false)
  })

  it("does NOT count {contract} patterns when chain_map can't satisfy the snapshot's chain", () => {
    // Native chain solana, chain_map only knows ethereum → the dex row
    // will never resolve (chain_map mismatch). It's `unresolvable`,
    // not `pending-meta` — `ensure` won't bring it back. Reserving a
    // shimmer would dangle forever. The probe (tryResolveTemplate) is
    // the single source of truth that decides this — both
    // expandTemplates and countPendingTemplates must agree.
    const restricted: LinkTemplate = {
      ...PATTERN_DEX,
      chain_map: { ethereum: "ethereum" },
    }
    const out = countPendingTemplates([restricted], SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "solana",
        links: {},
        detail_platforms: {
          solana: { contract_address: "SoL", decimal_place: 9 },
        },
      },
    })
    expect(out.byCategory["dex"]).toBeUndefined()
    expect(out.hasContractPending).toBe(false)
  })

  it("ignores disabled templates", () => {
    const out = countPendingTemplates(
      [{ ...PROVIDER_HOMEPAGE, enabled: false }, PROVIDER_TWITTER],
      SAMPLE_VARS,
      {},
    )
    expect(out.byCategory["site"]).toBeUndefined()
    expect(out.byCategory["social"]).toBe(1)
  })
})

/**
 * The probe `tryResolveTemplate` is the *single* source of truth shared
 * by `expandTemplates` and `countPendingTemplates`. These tests assert
 * that contract, so a future change to chain_map handling / registry
 * shape / template kinds only needs to land in the probe — the two
 * callers cannot diverge silently.
 */
describe("resolve invariant: probe is the shared code path", () => {
  const cryptoMeta = (): Record<string, unknown> => ({
    coingecko: { links: { homepage: ["https://bitcoin.org/", ""] } },
  })

  it("provider with known source_key + missing meta: probe=pending-meta → reserved, but NOT rendered", () => {
    const t = PROVIDER_HOMEPAGE // provider=coingecko, source_key=homepage
    const probe = tryResolveTemplate(t, SAMPLE_VARS, {})
    expect(probe.status).toBe("pending-meta")
    const pending = countPendingTemplates([t], SAMPLE_VARS, {})
    expect(pending.byCategory["site"]).toBe(1)
    expect(expandTemplates([t], SAMPLE_VARS, {})).toHaveLength(0)
  })

  it("provider with known source_key + present meta: probe=resolved → rendered, NOT reserved", () => {
    const t = PROVIDER_HOMEPAGE
    const probe = tryResolveTemplate(t, SAMPLE_VARS, cryptoMeta())
    expect(probe.status).toBe("resolved")
    const pending = countPendingTemplates([t], SAMPLE_VARS, cryptoMeta())
    expect(pending.byCategory["site"]).toBeUndefined()
    expect(expandTemplates([t], SAMPLE_VARS, cryptoMeta())).toHaveLength(1)
  })

  it("provider with UNKNOWN source_key (registry miss) + missing meta: probe=pending-meta → reserved", () => {
    // A row was published with source_key="not_in_registry" but the
    // registry still doesn't have it. resolveSource will return null
    // even with full meta — but until meta arrives, we cannot know
    // that. We treat this as pending-meta so the shimmer reserves a
    // slot. If meta arrives and resolution still fails, the slot is
    // released on upgrade (the row just doesn't appear). This matches
    // existing behaviour: SOURCE_REGISTRY lookup is irrelevant to the
    // "is it delayed by meta?" question.
    const tUnknown: LinkTemplate = {
      id: "u1",
      kind: "provider",
      category: "site",
      label: "Site",
      provider: "coingecko",
      source_key: "definitely-not-in-registry",
      tier: "Trusted",
      sort: 10,
      enabled: true,
    }
    const probe = tryResolveTemplate(tUnknown, SAMPLE_VARS, {})
    expect(probe.status).toBe("pending-meta")
    const pending = countPendingTemplates([tUnknown], SAMPLE_VARS, {})
    expect(pending.byCategory["site"]).toBe(1)
  })

  it("provider with UNKNOWN source_key + present meta: probe=unresolvable → NOT reserved, NOT rendered", () => {
    const tUnknown: LinkTemplate = {
      id: "u2",
      kind: "provider",
      category: "site",
      label: "Site",
      provider: "coingecko",
      source_key: "definitely-not-in-registry",
      tier: "Trusted",
      sort: 10,
      enabled: true,
    }
    const probe = tryResolveTemplate(tUnknown, SAMPLE_VARS, cryptoMeta())
    expect(probe.status).toBe("unresolvable")
    const pending = countPendingTemplates([tUnknown], SAMPLE_VARS, cryptoMeta())
    expect(pending.byCategory["site"]).toBeUndefined()
    expect(expandTemplates([tUnknown], SAMPLE_VARS, cryptoMeta())).toHaveLength(
      0,
    )
  })

  it("provider with UNKNOWN provider name: probe=pending-meta when no snapshot, unresolvable WITH", () => {
    // Hypothetical future provider that has no registry. Without meta
    // it's pending (we can't know yet); once meta arrives, we still
    // can't resolve — unresolvable. Matches `resolveSource` semantics.
    const t: LinkTemplate = {
      id: "p-future",
      kind: "provider",
      category: "site",
      label: "Future",
      provider: "future_provider",
      source_key: "url",
      tier: "Trusted",
      sort: 10,
      enabled: true,
    }
    expect(tryResolveTemplate(t, SAMPLE_VARS, {}).status).toBe("pending-meta")
    expect(
      tryResolveTemplate(t, SAMPLE_VARS, {
        future_provider: { url: "https://example.com" },
      }).status,
    ).toBe("unresolvable")
  })

  it("{contract} pattern: probe=pending-meta when meta missing, resolved when chains match, unresolvable on mismatch", () => {
    // pending-meta without meta:
    expect(tryResolveTemplate(PATTERN_DEX, SAMPLE_VARS, {}).status).toBe(
      "pending-meta",
    )
    // resolved with matching chain:
    const resolved = tryResolveTemplate(PATTERN_DEX, SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "ethereum",
        links: {},
        detail_platforms: {
          ethereum: { contract_address: "0xEth", decimal_place: 18 },
        },
      },
    })
    expect(resolved.status).toBe("resolved")
    if (resolved.status === "resolved") {
      expect(resolved.url).toBe("https://dexscreener.com/ethereum/0xEth")
    }
    // unresolvable on chain mismatch:
    const restricted: LinkTemplate = {
      ...PATTERN_DEX,
      chain_map: { ethereum: "ethereum" },
    }
    expect(
      tryResolveTemplate(restricted, SAMPLE_VARS, {
        coingecko: {
          asset_platform_id: "solana",
          links: {},
          detail_platforms: {
            solana: { contract_address: "SoL", decimal_place: 9 },
          },
        },
      }).status,
    ).toBe("unresolvable")
  })

  it("invariant: templates reserved as pending ↔ templates that WILL render after meta", () => {
    // The contract for the partial-shimmer contract: every template
    // counted as pending right now must produce a link once the meta
    // it needs is supplied. We sweep over a mix and assert.
    const templates: LinkTemplate[] = [
      PROVIDER_HOMEPAGE, // site, provider=coingecko+homepage
      PROVIDER_TWITTER, // social, provider=coingecko+twitter
      PATTERN_DEX, // dex, {contract}/{chain}, chain_map covers solana
      {
        // Ensures expandTemplates drops {contract} on chain mismatch.
        ...PATTERN_DEX,
        id: "dex2",
        category: "dex-mismatch",
        chain_map: { ethereum: "ethereum" },
      },
      PATTERN_COINGECKO, // trade, {slug} — never pending
    ]

    const empty = countPendingTemplates(templates, SAMPLE_VARS, {})
    // Only meta-dependent templates count; {slug} never does.
    const expectedReserved = empty.byCategory["site"] + empty.byCategory["social"] + empty.byCategory["dex"]

    // Now give meta. The set of templates that WOULD render with full
    // meta must be exactly the set that was reserved as pending +
    // non-meta-dependent ones (i.e. {slug} patterns).
    const full = expandTemplates(templates, SAMPLE_VARS, {
      coingecko: {
        asset_platform_id: "solana",
        links: {
          homepage: ["https://bitcoin.org/", ""],
          twitter_screen_name: "bitcoin",
        },
        detail_platforms: {
          solana: { contract_address: "SoLAddr", decimal_place: 9 },
        },
      },
    })
    // We expect homepage, twitter, dex → 3; the mismatched dex does NOT
    // resolve (chain_map only knows ethereum); {slug} template also resolves.
    expect(full).toHaveLength(4)

    // Crucially: every "reserved" slot has a matching rendered row,
    // and no rendered row comes from a "non-reserved" template that
    // was meta-dependent. Test this by category: the union of {site, social, dex}
    // counts (pending) must equal the count of rendered rows in those
    // categories.
    const renderedByCat: Record<string, number> = {}
    for (const l of full) renderedByCat[l.category] = (renderedByCat[l.category] ?? 0) + 1
    expect(renderedByCat["site"]).toBe(empty.byCategory["site"] ?? 0)
    expect(renderedByCat["social"]).toBe(empty.byCategory["social"] ?? 0)
    expect(renderedByCat["dex"]).toBe(empty.byCategory["dex"] ?? 0)
    expect(renderedByCat["dex-mismatch"]).toBeUndefined()
    expect(expectedReserved).toBe(3) // site+social+dex
  })
})
