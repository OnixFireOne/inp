// lib/drawer-history.ts
// Pure helpers for keeping `window.history` in sync with the asset drawer
// state without coupling tests to a hook.
//
// Invariant the rest of the file relies on: at any time there is AT MOST
// ONE `history` entry whose pathname starts with `/asset/` ABOVE the
// catalog page. Switching coins reuses that single entry (replaceState),
// so a browser Back always closes the drawer in one step — regardless of
// how many coins the user clicked through.
//
//   open from catalog              → pushState("/asset/<id>")
//   switch coins while drawer open → replaceState("/asset/<id>")
//   reopen the current coin        → no history op
//   close                          → back() (one step, lands on catalog)

export interface HistoryLike {
  history: Pick<History, "pushState" | "replaceState" | "back">
  location: Pick<Location, "pathname">
}

/**
 * Mirror the drawer's open state into the URL. Cheap to call; does
 * nothing when the URL already matches.
 *
 * Intentionally accepts a `HistoryLike` so tests don't need a real
 * `window`. Real call sites pass `window.history` and
 * `window.location`.
 */
export function pushOrReplaceDrawerUrl(
  env: HistoryLike,
  id: string,
): "push" | "replace" | "noop" {
  const target = `/asset/${id}`
  const path = env.location.pathname
  if (path === target) return "noop"
  if (path.startsWith("/asset/")) {
    env.history.replaceState(null, "", target)
    return "replace"
  }
  env.history.pushState(null, "", target)
  return "push"
}

/**
 * Mirror the drawer's close state into the URL. Only calls `back()`
 * when the current entry IS an asset page — calling back from
 * somewhere else (e.g. user landed on /asset/X via menu, opened the
 * drawer, then closed) would push them off the catalog.
 */
export function maybeBackFromAsset(env: HistoryLike): boolean {
  if (env.location.pathname.startsWith("/asset/")) {
    env.history.back()
    return true
  }
  return false
}
