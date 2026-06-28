// proxy.ts (Next 16: middleware was renamed to proxy)
// Authoritative auth + role gate for /admin/* and /api/admin/*.
//
// Why this lives here and not in the admin layout:
//   Server Components can READ cookies but cannot WRITE them. The Supabase
//   SSR helper refreshes the JWT transparently inside auth.getUser(); when
//   that happens it tries to rotate the session cookies — which crashes a
//   Server Component with:
//     "Cookies can only be modified in a Server Action or Route Handler."
//   Middleware / proxy CAN write cookies, so we run the verification here,
//   write any rotated tokens onto the response, and (importantly) mirror
//   them onto the request cookies too so downstream Server Components and
//   Route Handlers in the same pipeline see the fresh tokens.
//
// Pattern: official Supabase "updateSession" recipe for App Router.
//
// Response policy by path family:
//   /admin/*       — Server Components. Failures become 307 redirects to
//                     /auth/signin (browser navigates). This is what the
//                     user-facing layout expects.
//   /api/admin/*   — JSON route handlers. Failures become JSON 401/403 so
//                     fetch() callers keep their promise-resolution shape
//                     and don't follow a redirect into an HTML page (which
//                     would surface as a confusing "Unexpected token <" parse
//                     error in the admin UI).
//
// Auth model:
//   - Login verified with getUser() — verifies the JWT signature, expiry,
//     and audience. Do NOT substitute getSession() (cookie-trusting, no
//     signature check — Supabase explicitly warns against using it as
//     authz on the server).
//   - Role lives in public.profiles (DB), not in app_metadata JWT, so we
//     make one indexed point-lookup by user_id (PK). Cheap.
//
// Failure modes (per path family):
//   /admin/*      no session -> 307 /auth/signin?next=...
//   /admin/*      not admin  -> 307 /
//   /api/admin/*  no session -> 401 { error: "unauthenticated" }
//   /api/admin/*  not admin  -> 403 { error: "forbidden" }

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export const config = {
  // /admin/*      — admin UI pages (renders Server Components downstream)
  // /api/admin/*  — admin Route Handlers (must be gated too: a route handler
  //                 can call assertAdmin() but defence-in-depth means the
  //                 gate happens here too, before the handler runs)
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/admin/")
}

export async function proxy(req: NextRequest) {
  // Pre-build the response we'll attach rotated cookies to. Forward the
  // incoming request headers so RSC downstream sees the same context.
  const res = NextResponse.next({ request: { headers: req.headers } })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    // Misconfigured server — fail closed.
    return deny(req, "server_misconfigured", 500)
  }

  const sb = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      // Official Supabase "updateSession" pattern: write to BOTH the outgoing
      // response (so the browser picks up rotated tokens) AND the incoming
      // request cookies (so anything downstream in this pipeline — Server
      // Components, Route Handlers, RSC fetches — sees the fresh tokens).
      setAll: (xs: Array<{ name: string; value: string; options?: object }>) => {
        for (const { name, value, options } of xs) {
          res.cookies.set(name, value, options)
          req.cookies.set(name, value)
        }
      },
    },
  })

  // IMPORTANT: do NOT run any other code between createServerClient and
  // getUser(). Doing so risks the session expiring between calls.
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser()

  if (userErr || !user) {
    return deny(req, "unauthenticated", 401)
  }

  // Role check — single PK lookup by user_id.
  const { data: profile, error: profileErr } = await sb
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (profileErr || !profile || profile.role !== "admin") {
    // Logged in but not an admin.
    return deny(req, "forbidden", 403)
  }

  return res
}

// Path-family-aware failure response.
//   - /admin/*     -> 307 redirect (preserves UX: browser navigates to signin
//                     or home).
//   - /api/admin/* -> JSON error with the appropriate HTTP status, so fetch()
//                     resolves with a Response the caller can handle. No
//                     redirect: following a 307 in a fetch from JSON code
//                     produces HTML where JSON was expected.
function deny(req: NextRequest, error: string, status: number): NextResponse {
  if (isApiRoute(req.nextUrl.pathname)) {
    return NextResponse.json(
      { ok: false, error },
      { status, headers: { "content-type": "application/json" } },
    )
  }
  // /admin/* — preserve the original redirect semantics:
  //   unauthenticated -> /auth/signin?next=<original>
  //   forbidden       -> /
  if (status === 401) {
    const url = req.nextUrl.clone()
    url.pathname = "/auth/signin"
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`
    return NextResponse.redirect(url)
  }
  // 403, 500, etc.
  const url = req.nextUrl.clone()
  url.pathname = "/"
  url.search = ""
  return NextResponse.redirect(url)
}