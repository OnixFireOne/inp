// lib/links/icon.test.ts
import { describe, expect, it } from "vitest"

import { classifyIcon, faviconFor, letterFor } from "./icon"

describe("classifyIcon", () => {
  it("classifies emoji strings", () => {
    expect(classifyIcon("🦎")).toEqual({ kind: "emoji", value: "🦎" })
  })
  it("classifies image URLs", () => {
    expect(classifyIcon("https://example.com/x.png")).toEqual({
      kind: "img",
      value: "https://example.com/x.png",
    })
  })
  it("returns 'none' for missing or the 'favicon' sentinel", () => {
    expect(classifyIcon(null)).toEqual({ kind: "none" })
    expect(classifyIcon(undefined)).toEqual({ kind: "none" })
    expect(classifyIcon("favicon")).toEqual({ kind: "none" })
  })
})

describe("faviconFor", () => {
  it("builds a google favicon URL for valid https hrefs", () => {
    expect(faviconFor("https://bitcoin.org/")).toBe(
      "https://www.google.com/s2/favicons?domain=bitcoin.org&sz=64",
    )
  })
  it("strips the leading www. from the host", () => {
    expect(faviconFor("https://www.example.com/foo")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    )
  })
  it("returns null for empty, '#' or non-http(s) hrefs", () => {
    expect(faviconFor("")).toBeNull()
    expect(faviconFor("#")).toBeNull()
    expect(faviconFor("javascript:alert(1)")).toBeNull()
    expect(faviconFor("mailto:hi@example.com")).toBeNull()
  })
})

describe("letterFor", () => {
  it("uppercases the first character of name", () => {
    expect(letterFor("bitcoin")).toBe("B")
    expect(letterFor("  ethereum")).toBe("E")
  })
  it("falls back to a dot when name is empty", () => {
    expect(letterFor("")).toBe("·")
    expect(letterFor("   ")).toBe("·")
  })
})