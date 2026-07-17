// lib/links/compose.test.ts
import { describe, expect, it } from "vitest"

import { composeLinksPayload } from "./compose"
import type { LinkTemplate } from "./resolve"
import type { Link } from "../../types/asset"

const templates: LinkTemplate[] = [
  {
    id: "tpl1",
    kind: "pattern",
    category: "trade",
    label: "CoinGecko",
    icon: "🦎",
    url_pattern: "https://www.coingecko.com/en/coins/{slug}",
    tier: "Core",
    sort: 10,
    enabled: true,
  },
]

const providerHomepage: LinkTemplate = {
  id: "tplSite",
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

const curated: Link = {
  id: "l1",
  asset_id: "bitcoin",
  name: "Curated",
  href: "https://curated.example",
  tier: "Core",
  category: "trade",
  icon: "⭐",
}

describe("composeLinksPayload", () => {
  it("uses curated links when any curated links exist", () => {
    const out = composeLinksPayload({
      asset: { id: "bitcoin", name: "Bitcoin", ticker: "BTC", status: "described" },
      assetId: "bitcoin",
      curated: [curated],
      categories: [],
      templates,
      assetVars: { coingecko_id: "bitcoin", ticker: "BTC" },
      metaByProvider: {},
    })
    expect(out.links).toEqual([curated])
    expect(out.generated).toBe(false)
    expect(out.status).toBe("described")
    expect(out.partial).toBeUndefined()
  })

  it("generates virtual links when curated list is empty", () => {
    const out = composeLinksPayload({
      asset: { id: "bitcoin", name: "Bitcoin", ticker: "BTC", status: "template" },
      assetId: "bitcoin",
      curated: [],
      categories: [],
      templates,
      assetVars: { coingecko_id: "bitcoin", ticker: "BTC" },
      metaByProvider: {},
    })
    expect(out.generated).toBe(true)
    expect(out.status).toBe("template")
    expect(out.links[0]).toMatchObject({
      id: "tpl:tpl1",
      asset_id: "bitcoin",
      name: "CoinGecko",
      href: "https://www.coingecko.com/en/coins/bitcoin",
      icon: "🦎",
      generated: true,
    })
    expect(out.partial).toBeUndefined()
  })

  it("marks missing asset as undescribed", () => {
    const out = composeLinksPayload({
      asset: null,
      assetId: "newcoin",
      curated: [],
      categories: [],
      templates,
      assetVars: { coingecko_id: "newcoin", ticker: "" },
      metaByProvider: {},
    })
    expect(out.status).toBe("undescribed")
    expect(out.generated).toBe(true)
  })

  it("marks partial=true on COLD-CLICK degradation (no allowPartial flag)", () => {
    // Click path: ensure ran and timed out (5s). Caller passes empty
    // metaByProvider, omit allowPartial. The probe sees the homepage
    // template is `pending-meta` → result MUST be partial so the
    // client triggers an upgrade fetch on the NEXT open. Otherwise
    // "open → ensure-timeout → close → reopen" is stuck with no
    // shimmer/no retry/no upgrade for the 12h RQ window.
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates: [providerHomepage],
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {},
    })
    expect(out.partial).toBe(true)
    expect(out.hasProviderPending).toBe(true)
    expect(out.hasContractPending).toBe(false)
    expect(out.pending).toEqual([{ categoryKey: "site", count: 1 }])
  })

  it("marks partial on prefetch path too (allowPartial flag is back-compat no-op)", () => {
    // The prefetch path passes a metaByProvider snapshot from the
    // local cache (possibly empty). Same code path now: probe decides.
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates: [providerHomepage],
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {},
      allowPartial: true, // legacy flag, now ignored
    })
    expect(out.partial).toBe(true)
    expect(out.hasProviderPending).toBe(true)
    expect(out.pending).toEqual([{ categoryKey: "site", count: 1 }])
  })

  it("does NOT mark partial if no templates are pending on meta", () => {
    // All templates are {slug}/{symbol} patterns — they don't need meta.
    // The probe returns `unresolvable` when ticker is empty (no
    // {symbol} value) BUT {slug} pattern has a slug (from assetVars),
    // so it resolves → no pending work at all.
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates,
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {},
    })
    expect(out.partial).toBeUndefined()
  })

  it("marks full (=non-partial) when meta is present and resolves every provider template", () => {
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates: [providerHomepage],
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {
        coingecko: { links: { homepage: ["https://m.example"] } },
      },
    })
    expect(out.partial).toBeUndefined()
    expect(out.links).toHaveLength(1)
    expect(out.links[0].href).toBe("https://m.example")
  })

  it("clicks + empty curated + meta missing → partial=true + hasContractPending for {contract} pattern", () => {
    // Ensures the contract-chip shimmer slot is reserved on cold click.
    // The probe reads chain/contract from cgMeta (NOT AssetVars), so we
    // pass partial cgMeta matching the platform — but with NO meta
    // present (empty metaByProvider), the probe returns pending-meta.
    const contractTpl: LinkTemplate = {
      id: "dex",
      kind: "pattern",
      category: "trade",
      label: "DexScreener",
      icon: "📊",
      url_pattern: "https://dexscreener.com/{chain}/{contract}",
      tier: "Trusted",
      sort: 20,
      enabled: true,
      chain_map: { ethereum: "ethereum", solana: "solana" },
    }
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates: [contractTpl],
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {},
    })
    expect(out.partial).toBe(true)
    expect(out.hasContractPending).toBe(true)
    expect(out.pending).toEqual([{ categoryKey: "trade", count: 1 }])
  })

  it("does NOT mark partial when cg snapshot is present but has NO fields the templates need", () => {
    // Regression guard: ensure DID run successfully and the snapshot is
    // persisted, but CG simply did not return anything useful for this
    // coin (no homepage, no detail_platforms, etc). The probe must
    // classify every template as `unresolvable` (because expandContract /
    // resolveSource return null on missing fields), NOT `pending-meta` —
    // otherwise the payload would carry partial=true forever, every
    // open would fire an upgrade fetch + 8s shimmer + Retry footer, even
    // though dgreying-TTL was already short. Both signals must agree:
    // partial=false ⇔ no shimmer ⇔ no upgrade ⇔ full payload.
    const contractTpl: LinkTemplate = {
      id: "dex",
      kind: "pattern",
      category: "trade",
      label: "DexScreener",
      url_pattern: "https://dexscreener.com/{chain}/{contract}",
      tier: "Trusted",
      sort: 20,
      enabled: true,
      chain_map: { ethereum: "ethereum" },
    }
    const homepage: LinkTemplate = {
      id: "site",
      kind: "provider",
      category: "site",
      label: "Site",
      provider: "coingecko",
      source_key: "homepage",
      tier: "Core",
      sort: 10,
      enabled: true,
    }
    const out = composeLinksPayload({
      asset: { id: "m", name: "M", ticker: "M", status: "template" },
      assetId: "m",
      curated: [],
      categories: [],
      templates: [contractTpl, homepage],
      assetVars: { coingecko_id: "m", ticker: "M" },
      metaByProvider: {
        // trimCgMeta guarantees `links: {}` and only adds
        // `detail_platforms` if CG returned a contract entry. Both
        // empty here ⇒ probe must classify templates as unresolvable.
        coingecko: {
          asset_platform_id: null,
          links: {
            homepage: undefined,
            whitepaper: undefined,
            blockchain_site: undefined,
            official_forum_url: undefined,
            chat_url: undefined,
            twitter_screen_name: undefined,
            telegram_channel_identifier: undefined,
            subreddit_url: undefined,
          },
          // detail_platforms intentionally absent
        },
      },
    })
    expect(out.partial).toBeUndefined()
    // hasProviderPending / hasContractPending / pending are only emitted
    // ON the partial branch — they are markers for "we're inside partial
    // mode and these are the reasons why". For a non-partial response
    // the payload simply omits them all.
  })
})