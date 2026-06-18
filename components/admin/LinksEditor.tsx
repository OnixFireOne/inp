"use client"
// components/admin/LinksEditor.tsx
// Flat CRUD on `links` for a given asset_id. No nesting in stage 1 — every
// link has parent_id = null. Tree UI is stage 1.5 (schema is already ready).
//
// Uses Refine v5 hooks:
//   - useList({ resource: "links", filters: permanent asset_id eq })
//   - useCreate / useUpdate / useDelete for inline edits
//
// (Stage 1 doesn't need useTable + column-sorting — that comes in stage 1.5
//  together with the tree.)
//
// Each row: name, description, href, tier, category, is_top, manual_rank,
// health. Favicon from the href (Google s2) when the link has no icon.
import { useState } from "react"
import { useList, useCreate, useUpdate, useDelete, type CrudFilter } from "@refinedev/core"
import { faviconUrl } from "@/lib/admin/favicon"

type LinkRow = {
  id: string
  asset_id: string
  name: string
  description: string | null
  href: string
  tier: string
  category: string
  is_top: boolean | null
  manual_rank: number | null
  health: string | null
}

const TIERS = ["Core", "Trusted", "External"]
const CATEGORIES = ["trade", "chart", "earn", "tools", "news", "social", "review", "team", "tokenomics", "aggregator"]
const HEALTH = ["alive", "broken", "unknown"]

export function LinksEditor({ assetId }: { assetId: string }) {
  // Permanent filter: this editor only sees links belonging to assetId.
  const filters: CrudFilter[] = [{ field: "asset_id", operator: "eq", value: assetId }]

  const { query, result } = useList<LinkRow>({
    resource: "links",
    filters,
    queryOptions: { enabled: !!assetId },
  })

  const rows = result.data
  const err = (query.error ?? null) as { message?: string } | null

  const create = useCreate()
  const update = useUpdate()
  const remove = useDelete()

  const [editing, setEditing] = useState<Partial<LinkRow> | null>(null)

  async function submit() {
    if (!editing) return
    const payload: Partial<LinkRow> = {
      asset_id: assetId,
      name: editing.name?.trim() || "(без названия)",
      description: editing.description?.trim() || null,
      href: editing.href?.trim() || "",
      tier: editing.tier || "Trusted",
      category: editing.category || "tools",
      is_top: !!editing.is_top,
      manual_rank: editing.manual_rank ?? null,
      health: editing.health || "alive",
    }
    if (!payload.href) return
    if (editing.id) {
      await update.mutateAsync({ resource: "links", id: editing.id, values: payload })
    } else {
      await create.mutateAsync({ resource: "links", values: payload })
    }
    setEditing(null)
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить ссылку?")) return
    await remove.mutateAsync({ resource: "links", id })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Ссылки ({rows.length})</h3>
        <button
          onClick={() => setEditing({ asset_id: assetId, tier: "Trusted", category: "tools", health: "alive", is_top: false })}
          className="px-3 py-1.5 rounded border text-sm"
        >
          + Добавить ссылку
        </button>
      </div>

      {err?.message && <div className="text-sm text-rose-600">{err.message}</div>}

      <div className="border rounded divide-y">
        {query.isLoading && (
          <div className="px-3 py-3 text-sm text-[var(--text-mut)]">загрузка…</div>
        )}
        {!query.isLoading && rows.length === 0 && (
          <div className="px-3 py-3 text-sm text-[var(--text-mut)]">пусто</div>
        )}
        {rows.map((r) => {
          const fav = faviconUrl(r.href)
          return (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {fav && <img src={fav} alt="" className="w-4 h-4" />}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-[var(--text-mut)]">{r.href}</div>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded border">{r.tier}</span>
              <span className="text-xs px-1.5 py-0.5 rounded border text-[var(--text-mut)]">{r.category}</span>
              {r.is_top && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200/40">top</span>}
              <button onClick={() => setEditing(r)} className="text-xs text-[var(--text-mut)] hover:underline">ред.</button>
              <button onClick={() => onDelete(r.id)} className="text-xs text-rose-600 hover:underline">×</button>
            </div>
          )
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] rounded-xl w-full max-w-xl p-5 space-y-3">
            <h4 className="font-medium">{editing.id ? "Редактировать ссылку" : "Новая ссылка"}</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="name">
                <input className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="href">
                <input className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.href ?? ""} onChange={(e) => setEditing({ ...editing, href: e.target.value })} placeholder="https://…" />
              </Field>
              <Field label="description">
                <input className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </Field>
              <Field label="tier">
                <select className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.tier ?? "Trusted"} onChange={(e) => setEditing({ ...editing, tier: e.target.value })}>
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="category">
                <select className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.category ?? "tools"} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="manual_rank">
                <input type="number" className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.manual_rank ?? ""} onChange={(e) => setEditing({ ...editing, manual_rank: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
              <Field label="health">
                <select className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.health ?? "alive"} onChange={(e) => setEditing({ ...editing, health: e.target.value })}>
                  {HEALTH.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="is_top">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!editing.is_top} onChange={(e) => setEditing({ ...editing, is_top: e.target.checked })} />
                  <span className="text-sm">в топе</span>
                </label>
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={submit} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm">Сохранить</button>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border text-sm">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-[var(--text-mut)]">{label}</span>
      {children}
    </label>
  )
}
