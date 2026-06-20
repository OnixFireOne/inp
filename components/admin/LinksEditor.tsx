"use client"
// components/admin/LinksEditor.tsx
// Flat CRUD on `links` for a given asset_id.
//
// Uses Refine v5 hooks:
//   - useList({ resource: "links", filters: permanent asset_id eq })
//   - useList({ resource: "link_categories" }) — dynamic, replaces hardcoded CATEGORIES
//   - useCreate / useUpdate / useDelete for inline edits
//
// Each row: name, description, href, tier, category, is_top, manual_rank,
// health, icon. Favicon as fallback when icon is not set.
import { useState, useMemo } from "react"
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
  icon: string | null
}

type Category = {
  key: string
  label: string
  icon: string | null
  sort: number
}

const TIERS = ["Core", "Trusted", "External"]
const HEALTH = ["alive", "broken", "unknown"]

export function LinksEditor({ assetId }: { assetId: string }) {
  // --- categories from DB ---
  const catQuery = useList<Category>({
    resource: "link_categories",
    sorters: [{ field: "sort", order: "asc" }],
  })
  const categories = catQuery.query.data?.data ?? []
  const categoryMap = useMemo(() => {
    const m = new Map<string, Category>()
    for (const c of categories) m.set(c.key, c)
    return m
  }, [categories])

  // --- links ---
  const filters: CrudFilter[] = [{ field: "asset_id", operator: "eq", value: assetId }]
  const { query, result } = useList<LinkRow>({
    resource: "links",
    filters,
    pagination: { mode: "off" },
    sorters: [{ field: "manual_rank", order: "asc" }],
    queryOptions: { enabled: !!assetId },
  })

  const allRows = result.data ?? []
  const err = (query.error ?? null) as { message?: string } | null

  const create = useCreate()
  const update = useUpdate()
  const remove = useDelete()

  const [editing, setEditing] = useState<Partial<LinkRow> | null>(null)

  // Category filter state (client-side, no extra query)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const rows = useMemo(
    () => (activeCategory ? allRows.filter((r) => r.category === activeCategory) : allRows),
    [allRows, activeCategory],
  )

  // Category counts (over unfiltered set)
  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of allRows) {
      m.set(r.category, (m.get(r.category) ?? 0) + 1)
    }
    return m
  }, [allRows])

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
      icon: editing.icon ?? null,
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

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 text-xs rounded border ${!activeCategory ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
        >
          Все <span className="text-[var(--text-mut)]">({allRows.length})</span>
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
            className={`px-2.5 py-1 text-xs rounded border ${activeCategory === cat.key ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
          >
            {cat.icon ? `${cat.icon} ` : ""}{cat.label}
            {catCounts.get(cat.key) != null && (
              <span className="text-[var(--text-mut)] ml-1">({catCounts.get(cat.key)})</span>
            )}
          </button>
        ))}
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
          const cat = categoryMap.get(r.category)
          const imgSrc = r.icon ?? faviconUrl(r.href)
          return (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {imgSrc && <img src={imgSrc} alt="" className="w-4 h-4" />}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-[var(--text-mut)]">{r.href}</div>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded border">{r.tier}</span>
              <span className="text-xs px-1.5 py-0.5 rounded border text-[var(--text-mut)]">
                {cat ? `${cat.icon ?? ""} ${cat.label}` : r.category}
              </span>
              {r.is_top && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200/40">top</span>}
              <button onClick={() => setEditing(r)} className="text-xs text-[var(--text-mut)] hover:underline">ред.</button>
              <button onClick={() => onDelete(r.id)} className="text-xs text-rose-600 hover:underline">×</button>
            </div>
          )
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] rounded-xl w-full max-w-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
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
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>{c.icon ? `${c.icon} ` : ""}{c.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="icon URL">
                <input className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.icon ?? ""} onChange={(e) => setEditing({ ...editing, icon: e.target.value || null })} placeholder="https://… (фавикон если пусто)" />
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
