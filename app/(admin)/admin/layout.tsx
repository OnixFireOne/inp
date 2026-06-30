// app/(admin)/admin/layout.tsx
// Authoritative auth + role check lives in proxy.ts (see comment there for
// why: Server Components can't write cookies, so the Supabase session
// refresh crashes here if we try). Proxy already gates /admin/:path* AND
// /api/admin/:path*, so anything that reaches this layout has been
// verified. We keep a defence-in-depth second layer here: even if a future
// change to the matcher accidentally lets a non-admin route through, this
// layout will still redirect.
//
// getUser() (not getSession()) — Supabase explicitly warns that
// getSession() on the server trusts the cookie without verifying the JWT
// signature, so it cannot be used as authz.
import { redirect } from "next/navigation"
import { supabaseServer } from "@/lib/supabase/server"
import { AdminProviders } from "./providers"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sb = await supabaseServer()
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser()

  if (userErr) throw userErr
  if (!user) {
    redirect("/auth/signin?next=/admin")
  }

  // Role lives in DB, not JWT — single index-lookup.
  const { data: profile, error: profileErr } = await sb
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (profileErr) throw profileErr
  if (!profile || profile.role !== "admin") {
    redirect("/")
  }

  return <AdminProviders>{children}</AdminProviders>
}