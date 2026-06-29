// lib/asset-meta/coingecko.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchCoinMeta, trimCgMeta } from "./coingecko"

afterEach(() => {
  vi.unstubAllGlobals()
})

const RAW = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  // Stuff we DON'T want to keep:
  localization: { en: "Bitcoin" },
  description: { en: "long text..." },
  market_data: { current_price: { usd: 1 } },
  tickers: [{ id: "t1" }],
  // Stuff we DO want:
  links: {
    homepage: ["https://bitcoin.org/", ""],
    whitepaper: "https://bitcoin.org/bitcoin.pdf",
    blockchain_site: ["https://blockchair.com/bitcoin"],
    official_forum_url: ["https://bitcointalk.org"],
    chat_url: [],
    twitter_screen_name: "bitcoin",
    telegram_channel_identifier: "bitcoin",
    subreddit_url: "https://reddit.com/r/bitcoin",
    repos_url: { github: ["https://github.com/bitcoin/bitcoin"] },
    announcements_url: ["https://bitcointalk.org/ann"],
    snapshot_url: "https://snapshot.org",
  },
  detail_platforms: {
    "": { contract_address: "", decimal_place: "" }, // empty addr → skip
    ethereum: { contract_address: "0xabc", decimal_place: 8 },
  },
  image: {
    thumb: "https://i/btc-thumb.png",
    small: "https://i/btc-small.png",
    large: "https://i/btc-large.png",
  },
}

describe("trimCgMeta", () => {
  it("keeps only declared fields and drops empty arrays/strings", () => {
    const out = trimCgMeta(RAW as unknown as Record<string, unknown>)
    expect(out.links.homepage).toEqual(["https://bitcoin.org/"])
    expect(out.links.chat_url).toBeUndefined()
    expect(out.links.twitter_screen_name).toBe("bitcoin")
    expect(out.links.repos_url?.github).toEqual([
      "https://github.com/bitcoin/bitcoin",
    ])
    // Trimmed-out keys must not survive on the links object.
    expect((out.links as Record<string, unknown>).announcements_url).toBeUndefined()
    expect((out.links as Record<string, unknown>).snapshot_url).toBeUndefined()
    expect(out.detail_platforms?.ethereum.contract_address).toBe("0xabc")
    expect(out.detail_platforms?.ethereum.decimal_place).toBe(8)
    expect(out.image?.large).toBe("https://i/btc-large.png")
  })
})

describe("fetchCoinMeta", () => {
  it("returns trimmed data on 200", async () => {
    const res = new Response(JSON.stringify(RAW), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    )
    const out = await fetchCoinMeta("bitcoin")
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.data.links.whitepaper).toBe("https://bitcoin.org/bitcoin.pdf")
      expect(out.data.image?.thumb).toBe("https://i/btc-thumb.png")
    }
  })

  it("returns 404 sentinel on 404 from CG", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    )
    const out = await fetchCoinMeta("nope-coin")
    expect(out).toEqual({ ok: false, status: 404 })
  })

  it("returns 'error' on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net down")
      }),
    )
    const out = await fetchCoinMeta("bitcoin")
    expect(out).toEqual({ ok: false, status: "error" })
  })

  it("returns 'error' on non-JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not json", {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
      ),
    )
    const out = await fetchCoinMeta("bitcoin")
    expect(out).toEqual({ ok: false, status: "error" })
  })

  it("hits the no-keys CG URL", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url)
        return new Response(JSON.stringify(RAW), { status: 200 })
      }),
    )
    await fetchCoinMeta("bitcoin")
    expect(calls[0]).toContain("/coins/bitcoin")
    expect(calls[0]).toContain("localization=false")
    expect(calls[0]).toContain("market_data=false")
    expect(calls[0]).toContain("sparkline=false")
    expect(calls[0]).not.toContain("tickers=true")
  })
})