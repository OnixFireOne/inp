"use client"

// LinkIcon — final fallback chain per TЗ §8.4:
//   1. emoji                  (icon is a non-URL string)
//   2. image URL              (icon is an absolute http(s) URL)
//   3. google favicon by host (only if the image failed or no icon at all)
//   4. letter fallback        (first letter of `name`; hard terminal)
//
// The state is staged (not boolean) so both branches (icon-is-URL and
// icon-is-missing) converge to the letter fallback if the favicon also
// fails to load.

import { useState } from "react"

import { classifyIcon, faviconFor, letterFor } from "@/lib/links/icon"

interface LinkIconProps {
  href: string
  icon?: string | null
  name: string
  size?: number
}

export function LinkIcon({ href, icon, name, size = 22 }: LinkIconProps) {
  const cls = classifyIcon(icon)
  const [imgBroken, setImgBroken] = useState(false)
  const [faviconBroken, setFaviconBroken] = useState(false)
  const faviconUrl = faviconFor(href)

  // 1) emoji — terminal for this branch.
  if (cls.kind === "emoji" && cls.value) {
    return (
      <span
        className="link-icon"
        style={{ width: size, height: size, fontSize: size * 0.75 }}
        aria-hidden
      >
        {cls.value}
      </span>
    )
  }

  // 2) explicit image URL — fall through to favicon on error.
  if (cls.kind === "img" && cls.value && !imgBroken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cls.value}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgBroken(true)}
        className="link-icon"
        style={{ width: size, height: size }}
      />
    )
  }

  // 3) google favicon (used both when icon was a broken image and when no icon).
  if (faviconUrl && !faviconBroken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={faviconUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFaviconBroken(true)}
        className="link-icon"
        style={{ width: size, height: size }}
      />
    )
  }

  // 4) letter (hard terminal).
  return (
    <span
      className="link-icon-fallback"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {letterFor(name)}
    </span>
  )
}