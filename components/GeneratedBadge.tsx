"use client"

// GeneratedBadge — "🤖 Auto" / "Template" pill for the asset header.
// English label per repo convention (decision #21).
// Shown when generated===true OR status==="template"; hidden for described.

export type GeneratedBadgeStatus = "described" | "template" | "undescribed"

export function GeneratedBadge({
  generated,
  status,
}: {
  generated?: boolean
  status?: GeneratedBadgeStatus
}) {
  if (!generated && status !== "template") return null
  const label = status === "template" ? "Template" : "Auto"
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-600"
      title="Links are generated from templates (auto-curated)"
    >
      <span aria-hidden>🤖</span>
      {label}
    </span>
  )
}