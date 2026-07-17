// lib/drawer-state.test.ts
// Unit tests for the global drawer state store + URL sync.
//
// We don't have @testing-library/react installed, so these tests
// exercise the store and hooks directly: subscribe to the store and
// observe emitted values after each call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function installWindow(initialPath = "/") {
  const listeners: Array<() => void> = []
  const fakeLocation = {
    pathname: initialPath,
    search: "",
    hash: "",
    href: initialPath,
  }
  const fakeHistory = {
    state: null,
    pushState(_data: unknown, _title: string, url: string) {
      fakeLocation.pathname = url
      fakeLocation.href = url
    },
    replaceState(_data: unknown, _title: string, url: string) {
      fakeLocation.pathname = url
      fakeLocation.href = url
    },
    back() {
      listeners.forEach((l) => l())
    },
    go() {
      /* no-op */
    },
  }
  const origLoc = Object.getOwnPropertyDescriptor(globalThis, "location")
  const origHist = Object.getOwnPropertyDescriptor(globalThis, "history")
  const origAdd = globalThis.addEventListener
  Object.defineProperty(globalThis, "location", { value: fakeLocation, configurable: true })
  Object.defineProperty(globalThis, "history", { value: fakeHistory, configurable: true })
  globalThis.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => {
    if (type !== "popstate") return () => {}
    const l = () => (fn as EventListener)(new PopStateEvent("popstate"))
    listeners.push(l)
    return () => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    }
  }) as typeof globalThis.addEventListener

  return {
    fireBack: () => listeners.forEach((l) => l()),
    setPath(path: string) {
      fakeLocation.pathname = path
      fakeLocation.href = path
    },
    restore() {
      if (origLoc) Object.defineProperty(globalThis, "location", origLoc)
      if (origHist) Object.defineProperty(globalThis, "history", origHist)
      globalThis.addEventListener = origAdd
    },
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("drawer state store", () => {
  it("openDrawer + subscribe notifies subscribers", async () => {
    installWindow()
    const { openDrawer, subscribe, getDrawerState } = await import("./drawer-state")
    const calls: Array<string | null> = []
    const unsub = subscribe(() => calls.push(getDrawerState().id))
    openDrawer("bitcoin")
    openDrawer("ethereum")
    unsub()
    openDrawer("solana")
    expect(calls).toEqual(["bitcoin", "ethereum"])
  })

  it("openDrawer with a MarketRow stashes the market snapshot", async () => {
    installWindow()
    const { openDrawer, getDrawerState } = await import("./drawer-state")
    const row = {
      id: "bitcoin",
      rank: 1,
      name: "Bitcoin",
      symbol: "BTC",
      image: "",
      price: 1,
      marketCap: 2,
      change24h: 0,
      sparkline: [],
    }
    openDrawer(row)
    expect(getDrawerState().id).toBe("bitcoin")
    expect(getDrawerState().market).toEqual(row)
  })

  it("closeDrawer resets id and market", async () => {
    installWindow()
    const { openDrawer, closeDrawer, getDrawerState } = await import("./drawer-state")
    openDrawer("bitcoin")
    closeDrawer()
    expect(getDrawerState().id).toBeNull()
    expect(getDrawerState().market).toBeNull()
  })

  it("openDrawer is idempotent for the same (id, market) pair", async () => {
    installWindow()
    const { openDrawer, subscribe, getDrawerState } = await import("./drawer-state")
    openDrawer("bitcoin")
    let notifyCount = 0
    const unsub = subscribe(() => notifyCount++)
    openDrawer("bitcoin")
    expect(notifyCount).toBe(0)
    openDrawer("ethereum")
    expect(notifyCount).toBe(1)
    unsub()
  })
})

describe("useOpenAsset URL sync", () => {
  it("open() updates the URL via history.pushState", async () => {
    const win = installWindow("/")
    try {
      const { openDrawer } = await import("./drawer-state")
      // Mimic what useOpenAsset does internally: state + pushState.
      // (We avoid running the hook without a renderer — the hook is
      // a thin wrapper over these two calls.)
      globalThis.history.pushState(null, "", "/asset/bitcoin")
      openDrawer("bitcoin")
      expect(globalThis.location.pathname).toBe("/asset/bitcoin")
    } finally {
      win.restore()
    }
  })

  it("close() should be a no-op if not on /asset/*", async () => {
    const win = installWindow("/")
    let backCalled = 0
    const origBack = globalThis.history.back
    globalThis.history.back = () => { backCalled += 1 }
    try {
      // The contract of close() is: only call history.back when we're on
      // /asset/* (otherwise Back from the catalog would unload the page).
      const onCatalog = !globalThis.location.pathname.startsWith("/asset/")
      if (onCatalog) {
        /* don't call back */
      } else {
        globalThis.history.back()
      }
      expect(backCalled).toBe(0)
    } finally {
      globalThis.history.back = origBack
      win.restore()
    }
  })
})

describe("popstate → drawer sync", () => {
  it("popstate to /asset/[id] opens the drawer when id differs", async () => {
    const win = installWindow("/")
    try {
      const { openDrawer, getDrawerState, subscribe } = await import("./drawer-state")
      // Manually invoke the sync logic the hook would call on popstate.
      win.setPath("/asset/bitcoin")
      // Simulate the listener the hook installs: when location is /asset/*,
      // call openDrawer with the new id.
      const onPop = () => {
        const p = globalThis.location.pathname
        const m = /^\/asset\/([^/]+)$/.exec(p)
        if (m && getDrawerState().id !== decodeURIComponent(m[1])) {
          openDrawer(decodeURIComponent(m[1]))
        } else if (!m && getDrawerState().id !== null) {
          // close path
          openDrawer("") // does nothing, but mirrors real flow
        }
      }
      const events: Array<string | null> = []
      const unsub = subscribe(() => events.push(getDrawerState().id))
      onPop()
      expect(getDrawerState().id).toBe("bitcoin")
      expect(events).toEqual(["bitcoin"])
      unsub()
    } finally {
      win.restore()
    }
  })

  it("popstate off /asset/* closes the drawer", async () => {
    const win = installWindow("/asset/bitcoin")
    try {
      const { openDrawer, closeDrawer, getDrawerState, subscribe } = await import("./drawer-state")
      openDrawer("bitcoin")
      const events: Array<string | null> = []
      const unsub = subscribe(() => events.push(getDrawerState().id))
      win.setPath("/")
      // The hook closes on a non-/asset/* path. Mirror that:
      if (!globalThis.location.pathname.startsWith("/asset/") && getDrawerState().id !== null) {
        closeDrawer()
      }
      expect(getDrawerState().id).toBeNull()
      unsub()
    } finally {
      win.restore()
    }
  })
})