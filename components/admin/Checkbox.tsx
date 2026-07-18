"use client"
// components/admin/Checkbox.tsx
// Styled checkbox matching admin palette: accent fill, rounded corners,
// focus ring, disabled state. Replaces all native <input type="checkbox">.

import { forwardRef, type InputHTMLAttributes } from "react"

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", label, disabled, ...props }, ref) => {
    return (
      <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            disabled={disabled}
            className={`
              peer appearance-none w-4 h-4 rounded border border-[var(--border)]
              bg-[var(--surface)] transition-all duration-150
              checked:bg-[var(--accent)] checked:border-[var(--accent)]
              focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1 focus:ring-offset-[var(--surface)]
              disabled:cursor-not-allowed disabled:opacity-50
              ${className}
            `}
            {...props}
          />
          {/* Checkmark SVG, visible when checked */}
          <svg
            className="absolute top-0 left-0 w-4 h-4 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity duration-150"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M3.5 8.5L6.5 11.5L12.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {label && (
          <span className={`text-sm ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
            {label}
          </span>
        )}
      </label>
    )
  },
)
Checkbox.displayName = "Checkbox"
