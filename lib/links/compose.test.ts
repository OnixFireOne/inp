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
})