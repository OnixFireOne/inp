// lib/links/label-from-url.test.ts
import { describe, expect, it } from "vitest"

import { labelFromUrl } from "./label-from-url"

describe("labelFromUrl", () => {
  it("takes the second-level domain for a normal host", () => {
    expect(labelFromUrl("https://blockchair.com/btc")).toBe("Blockchair")
    expect(labelFromUrl("https://dexscreener.com/ethereum")).toBe("Dexscreener")
    expect(labelFromUrl("https://etherscan.io/address/0xabc")).toBe("Etherscan")
  })

  it("strips a leading www.", () => {
    expect(labelFromUrl("https://www.coingecko.com/btc")).toBe("Coingecko")
  })

  it("uses the deepest meaningful label for subdomains", () => {
    expect(labelFromUrl("https://explorer.solana.com/address/abc")).toBe("Solana")
  })

  it("applies explicit overrides", () => {
    expect(labelFromUrl("https://x.com/bitcoin")).toBe("X (Twitter)")
    expect(labelFromUrl("https://twitter.com/bitcoin")).toBe("X (Twitter)")
    expect(labelFromUrl("https://t.me/bitcoin")).toBe("Telegram")
    expect(labelFromUrl("https://github.com/bitcoin/bitcoin")).toBe("GitHub")
  })

  it("returns undefined for invalid URLs", () => {
    expect(labelFromUrl("not a url")).toBeUndefined()
    expect(labelFromUrl("")).toBeUndefined()
    expect(labelFromUrl("")).toBeUndefined()
  })
})