"use client"
import { useState, useEffect } from "react"
import { supabaseBrowser } from "@/lib/supabase/client"

export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([])
  const [isLoading, setLoading] = useState(true)

  const sb = supabaseBrowser()

  useEffect(() => {
    // load from localStorage or DB
    const raw = localStorage.getItem("inp.watchlist")
    if (raw) setIds(JSON.parse(raw))
    setLoading(false)
  }, [])

  async function toggle(assetId: string) {
    const next = ids.includes(assetId)
      ? ids.filter(id => id !== assetId)
      : [...ids, assetId]
    setIds(next)
    localStorage.setItem("inp.watchlist", JSON.stringify(next))

    // if signed in, sync to DB (optimistic)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      if (next.includes(assetId)) {
        await sb.from("watchlist").insert({ user_id: user.id, asset_id: assetId }).catch(() => {})
      } else {
        await sb.from("watchlist").delete().match({ user_id: user.id, asset_id: assetId }).catch(() => {})
      }
    }
  }

  function isInWatchlist(assetId: string) {
    return ids.includes(assetId)
  }

  return { ids, toggle, isInWatchlist, isLoading }
}
