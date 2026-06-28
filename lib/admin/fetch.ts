// lib/admin/fetch.ts
// Wrapper around fetch() for /api/admin/* calls from the admin UI.
//
// Why this exists:
//   proxy.ts (middleware) now returns JSON 401 / 403 for /api/admin/* when
//   the user is not authenticated / not an admin. Earlier versions of the
//   proxy redirected to /auth/signin, which broke fetch() — following a
//   redirect in a JSON fetch hands the caller an HTML page that fails to
//   parse.
//
//   This helper:
//     1. Calls the endpoint with credentials (so cookies ride along).
//     2. Surfaces 401 by redirecting the browser to /auth/signin?next=...
//        (matches the policy used by the /admin/* layout).
//     3. Surfaces 403 with a typed error so the UI can show "нет прав".
//     4. Throws on any other non-OK status, including the response body
//        text — same behaviour the call sites had inline before.
export class AdminForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message)
    this.name = "AdminForbiddenError"
  }
}

export class AdminUnauthenticatedError extends Error {
  constructor(message = "unauthenticated") {
    super(message)
    this.name = "AdminUnauthenticatedError"
  }
}

function currentNextPath(): string {
  if (typeof window === "undefined") return "/admin"
  return window.location.pathname + window.location.search
}

export async function adminFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    // Required so the session cookie is sent on same-origin fetches.
    credentials: init.credentials ?? "same-origin",
    cache: init.cache ?? "no-store",
  })

  if (res.status === 401) {
    // Session expired or revoked. Bounce to signin with the current URL as
    // the post-login destination. Same pattern the /admin/* layout uses.
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(currentNextPath())
      window.location.href = `/auth/signin?next=${next}`
    }
    throw new AdminUnauthenticatedError()
  }

  if (res.status === 403) {
    throw new AdminForbiddenError()
  }

  return res
}