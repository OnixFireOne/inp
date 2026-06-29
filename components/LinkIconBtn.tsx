"use client"

// Wraps an icon link. Hover shows a Radix Tooltip with name (title) +
// optional description. Radix handles:
//   - Portal → escapes any overflow:hidden/auto ancestor
//   - Collision detection (flip + shift) → stays inside the viewport
//   - fixed positioning relative to viewport
// No need for custom edge logic or ResizeObserver.

import * as Tooltip from "@radix-ui/react-tooltip"
import { LinkIcon } from "./LinkIcon"

interface LinkIconBtnProps {
  href: string
  icon?: string | null
  name: string
  description?: string | null
  size: number
  generated?: boolean
}

export function LinkIconBtn({ href, icon, name, description, size, generated }: LinkIconBtnProps) {
  return (
    <Tooltip.Root delayDuration={150} disableHoverableContent={false}>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={`link-icon-btn${generated ? " link-icon-btn--generated" : ""}`}
          aria-label={description ? `${name} — ${description}` : name}
        >
          <LinkIcon href={href} icon={icon} name={name} size={size} />
        </a>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={10}
          collisionPadding={8}
          className="link-tooltip"
        >
          <div className="link-tooltip-title">{name}</div>
          {description && <div className="link-tooltip-desc">{description}</div>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}