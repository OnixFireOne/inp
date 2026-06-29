// lib/links/materialize.test.ts
import { describe, expect, it } from "vitest"

import type { GeneratedLink } from "./resolve"
import { buildMaterializeRows } from "./materialize"

const generated = (url: string, label = url): GeneratedLink => ({
  id: `tpl:${label}`,
  url,
  label,
  icon: undefined,
  category: "site",
  tier: "Trusted",
  generated: true,
  is_top: false,
  manual_rank: null,
  ai_score: null,
  _sort: 10,
})

describe("buildMaterializeRows", () => {
  it("dedupes against existing curated links by normalizeUrl", () => {
    const rows = buildMaterializeRows(
      [generated("https://example.com/"), generated("https://new.example")],
      ["https://example.com"],
      "bitcoin",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].href).toBe("https://new.example")
  })

  it("assigns manual_rank in generated order after filtering", () => {
    const rows = buildMaterializeRows(
      [generated("https://a.example", "A"), generated("https://b.example", "B")],
      [],
      "bitcoin",
    )
    expect(rows.map((r) => r.manual_rank)).toEqual([10, 20])
  })
})