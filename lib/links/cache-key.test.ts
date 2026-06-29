// lib/links/cache-key.test.ts
import { describe, expect, it, vi } from "vitest"

vi.mock("../kv", () => ({
  kvGet: async (k: string) => {
    if (k === "links:cache_version") return 2
    if (k === "link_templates:cache_version") return 7
    return null
  },
}))

import { buildLinkCacheKey, getLinkCacheKey } from "./cache-key"

describe("link cache key", () => {
  it("uses v and tv in the deterministic per-coin key", async () => {
    expect(buildLinkCacheKey("bitcoin", { v: 2, tv: 7 })).toBe(
      "links:v2:t7:bitcoin",
    )
    await expect(getLinkCacheKey("bitcoin")).resolves.toBe(
      "links:v2:t7:bitcoin",
    )
  })
})