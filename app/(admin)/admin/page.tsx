// app/(admin)/admin/page.tsx
// /admin -> /admin/catalog. Keep the entry shallow so links to /admin
// don't 404 before role check runs.
import { redirect } from "next/navigation"

export default function AdminIndex() {
  redirect("/admin/catalog")
}
