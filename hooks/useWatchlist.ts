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
    const wasIn = ids.includes(assetId)
    const next = wasIn
      ? ids.filter(id => id !== assetId)
      : [...ids, assetId]
    setIds(next)
    localStorage.setItem("inp.watchlist", JSON.stringify(next))

    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const op = wasIn
        ? sb.from("watchlist").delete().match({ user_id: user.id, asset_id: assetId })
        : sb.from("watchlist").insert({ user_id: user.id, asset_id: assetId })
      const { error } = await op
      if (error) {
        // rollback on DB failure
        const rollback = wasIn ? [...next, assetId] : next.filter(id => id !== assetId)
        setIds(rollback)
        localStorage.setItem("inp.watchlist", JSON.stringify(rollback))
      }
    }
  }

  function isInWatchlist(assetId: string) {
    return ids.includes(assetId)
  }

  return { ids, toggle, isInWatchlist, isLoading }
}
