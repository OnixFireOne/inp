"use client"
// components/admin/Toggle.tsx
// On/off toggle switch — matches the visual style of the "on/off" badges
// in the link-templates list. Single visual representation across the admin.

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}

export function Toggle({ checked, onChange, disabled, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (checked ? "On" : "Off")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full
        border transition-colors duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)]
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked
          ? "bg-[var(--up)] border-[var(--up)]"
          : "bg-[var(--surface-2)] border-[var(--border)]"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow
          transition-transform duration-150
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
    </button>
  )
}