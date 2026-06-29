// lib/links/to-link-insert.test.ts
import { describe, expect, it } from "vitest"

import type { GeneratedLink } from "./resolve"
import { toLinkInsert } from "./to-link-insert"

const gl: GeneratedLink = {
  id: "tpl:1",
  url: "https://example.com",
  label: "Example",
  icon: "🌐",
  category: "site",
  tier: "Core",
  generated: true,
  is_top: false,
  manual_rank: null,
  ai_score: null,
  _sort: 10,
}

describe("toLinkInsert", () => {
  it("maps GeneratedLink to DB insert row without id", () => {
    const row = toLinkInsert("bitcoin")(gl, 1)
    expect(row).toEqual({
      asset_id: "bitcoin",
      name: "Example",
      description: null,
      href: "https://example.com",
      tier: "Core",
      category: "site",
      icon: "🌐",
      is_top: false,
      manual_rank: 20,
      health: null,
    })
    expect(row).not.toHaveProperty("id")
  })
})