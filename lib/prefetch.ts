// lib/prefetch.ts
// Helper to warm the /api/links cache on row hover. Non-blocking.

export function prefetchLinks(coingeckoId: string) {
  if (typeof window === "undefined") return
  // Fire-and-forget. The browser will cache the GET.
  void fetch(`/api/links?cg=${encodeURIComponent(coingeckoId)}`, { method: "GET" }).catch(() => {})
}
