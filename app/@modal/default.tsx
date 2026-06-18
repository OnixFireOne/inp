// app/@modal/default.tsx
// Parallel slot default. Renders nothing when no modal is active.
// This keeps the @children slot (AssetTable) mounted across soft navigations,
// so list scroll position and React Query cache are preserved.

export default function Default() {
  return null
}
