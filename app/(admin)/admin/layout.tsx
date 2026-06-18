// app/(admin)/admin/layout.tsx
// Server-side guard: require a logged-in user with profiles.role='admin'.
// The lightweight auth check lives in middleware.ts; THIS is the authoritative
// role check. If it fails, we redirect (notFound is a UX choice — redirect
// keeps the URL stable and tells the user where to go).
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
  } = await sb.auth.getUser()

  if (!user) {
    redirect("/auth/signin?next=/admin")
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!profile || profile.role !== "admin") {
    // Logged in but not an admin. Send back home; don't leak the admin UI.
    redirect("/")
  }

  return <AdminProviders>{children}</AdminProviders>
}
