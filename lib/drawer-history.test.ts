// lib/drawer-history.test.ts
// Unit tests for the URL ↔ drawer history invariant.
//
// The contract these tests pin: opening coins in sequence produces AT
// MOST ONE history entry above the catalog, regardless of how many
// coins the user clicked through. Closing the drawer therefore lands
// on the catalog in a single back().

import { beforeEach, describe, expect, it } from "vitest"

import {
  pushOrReplaceDrawerUrl,
  maybeBackFromAsset,
  type HistoryLike,
} from "./drawer-history"

function makeHistory(initialPath = "/"): {
  env: HistoryLike
  entries: Array<{ op: "push" | "replace" | "back"; url?: string }>
} {
  const entries: Array<{ op: "push" | "replace" | "back"; url?: string }> = []
  const location = { pathname: initialPath }
  // Independent URL stack: push pushes, replace replaces the TOP, back
  // pops. This mirrors real browser history semantics closely enough
  // for the invariant we care about (at most one /asset/* above the
  // catalog).
  const stack: string[] = [initialPath]
  const history = {
    pushState(_d: unknown, _t: string, url: string) {
      entries.push({ op: "push", url })
      stack.push(url)
      location.pathname = url
    },
    replaceState(_d: unknown, _t: string, url: string) {
      entries.push({ op: "replace", url })
      stack[stack.length - 1] = url
      location.pathname = url
    },
    back() {
      entries.push({ op: "back" })
      if (stack.length > 1) stack.pop()
      location.pathname = stack[stack.length - 1]
    },
  }
  const env: HistoryLike = { history, location }
  return { env, entries }
}

describe("pushOrReplaceDrawerUrl", () => {
  it("opens from the catalog via pushState", () => {
    const { env, entries } = makeHistory("/")
    const op = pushOrReplaceDrawerUrl(env, "bitcoin")
    expect(op).toBe("push")
    expect(entries).toEqual([{ op: "push", url: "/asset/bitcoin" }])
  })

  it("switches coins while the drawer is open via replaceState (no history growth)", () => {
    const { env, entries } = makeHistory("/")
    pushOrReplaceDrawerUrl(env, "bitcoin")   // push → /asset/bitcoin
    const op = pushOrReplaceDrawerUrl(env, "ethereum") // replace
    expect(op).toBe("replace")
    expect(entries).toEqual([
      { op: "push", url: "/asset/bitcoin" },
      { op: "replace", url: "/asset/ethereum" },
    ])
  })

  it("chains three coin switches — still only one push (catalog + replace*2)", () => {
    const { env, entries } = makeHistory("/")
    pushOrReplaceDrawerUrl(env, "bitcoin")   // push
    pushOrReplaceDrawerUrl(env, "ethereum") // replace
    pushOrReplaceDrawerUrl(env, "solana")   // replace
    const pushes = entries.filter((e) => e.op === "push").length
    expect(pushes).toBe(1)
    expect(env.location.pathname).toBe("/asset/solana")
  })

  it("reopening the SAME coin does not touch history", () => {
    const { env, entries } = makeHistory("/asset/bitcoin")
    const op = pushOrReplaceDrawerUrl(env, "bitcoin")
    expect(op).toBe("noop")
    expect(entries).toEqual([])
  })

  it("opening the SAME coin from a different URL (deep link refresh) is a push", () => {
    // The user has a /catalog/spreadsheet URL, opens /asset/bitcoin from
    // there — that's a push, not a replace (no /asset/* is on top).
    const { env, entries } = makeHistory("/catalog")
    const op = pushOrReplaceDrawerUrl(env, "bitcoin")
    expect(op).toBe("push")
    expect(entries).toEqual([{ op: "push", url: "/asset/bitcoin" }])
  })
})

describe("maybeBackFromAsset", () => {
  it("calls back() when on /asset/*", () => {
    const { env, entries } = makeHistory("/asset/bitcoin")
    const didBack = maybeBackFromAsset(env)
    expect(didBack).toBe(true)
    expect(entries).toEqual([{ op: "back" }])
  })

  it("does NOT call back() from the catalog (would unload the page)", () => {
    const { env, entries } = makeHistory("/")
    const didBack = maybeBackFromAsset(env)
    expect(didBack).toBe(false)
    expect(entries).toEqual([])
  })

  it("does NOT call back() from a deep-linked /catalog page either", () => {
    const { env, entries } = makeHistory("/catalog")
    const didBack = maybeBackFromAsset(env)
    expect(didBack).toBe(false)
    expect(entries).toEqual([])
  })
})

describe("open-then-close end-to-end history shape", () => {
  it("opening A → B → C, then closing lands on the catalog in one back", () => {
    const { env, entries } = makeHistory("/")
    pushOrReplaceDrawerUrl(env, "bitcoin")   // push
    pushOrReplaceDrawerUrl(env, "ethereum")  // replace
    pushOrReplaceDrawerUrl(env, "solana")    // replace
    expect(env.location.pathname).toBe("/asset/solana")

    // The user closes the drawer. We expect ONE back to undo the only push.
    const didBack = maybeBackFromAsset(env)
    expect(didBack).toBe(true)
    expect(env.location.pathname).toBe("/")

    const pushCount = entries.filter((e) => e.op === "push").length
    const backCount = entries.filter((e) => e.op === "back").length
    expect(pushCount).toBe(1)
    expect(backCount).toBe(1)
  })

  it("closing while already on the catalog is a no-op", () => {
    const { env, entries } = makeHistory("/")
    expect(maybeBackFromAsset(env)).toBe(false)
    expect(entries).toEqual([])
  })
})

// Silence unused imports.
beforeEach(() => {})
void beforeEach
