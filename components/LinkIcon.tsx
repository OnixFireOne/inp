"use client"

// LinkIcon — favicon / thumbnail for a curated link.
// Priority: explicit thumbnailUrl → Google's favicon service by hostname →
// letter fallback on error. Tiny (20-24px), rounded, flex-shrink: 0.

import { useState } from "react"

interface LinkIconProps {
  href: string
  thumbnailUrl?: string | null
  name: string
  size?: number
}

function getDomain(href: string): string | null {
  try {
    const u = new URL(href)
    return u.hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function getLetter(name: string): string {
  const trimmed = (name || "").trim()
  return (trimmed[0] ?? "·").toUpperCase()
}

export function LinkIcon({ href, thumbnailUrl, name, size = 22 }: LinkIconProps) {
  const domain = getDomain(href)
  const [errored, setErrored] = useState(false)

  // Explicit thumbnail (DB-provided).
  if (thumbnailUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className="link-icon"
        style={{ width: size, height: size }}
      />
    )
  }

  // Google's favicon service fallback (best-effort, lazy + onerror to letter).
  if (domain && !errored) {
    const favicon = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={favicon}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
        className="link-icon"
        style={{ width: size, height: size }}
      />
    )
  }

  // Letter fallback.
  return (
    <span
      className="link-icon-fallback"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {getLetter(name)}
    </span>
  )
}
