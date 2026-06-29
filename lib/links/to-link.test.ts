// lib/links/to-link.test.ts
import { describe, expect, it } from "vitest"

import { toLink } from "./to-link"
import type { GeneratedLink } from "./resolve"

describe("toLink", () => {
  it("maps GeneratedLink to storefront Link shape", () => {
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
    expect(toLink(gl, "bitcoin")).toMatchObject({
      id: "tpl:1",
      asset_id: "bitcoin",
      name: "Example",
      href: "https://example.com",
      icon: "🌐",
      generated: true,
      is_top: false,
      manual_rank: null,
      ai_score: null,
    })
  })
})