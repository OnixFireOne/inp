"use client"
// components/admin/LinksEditor.tsx
// Flat CRUD on `links` for a given asset_id.
//
// Uses Refine v5 hooks:
//   - useList({ resource: "links", filters: permanent asset_id eq })
//   - useList({ resource: "link_categories" }) — dynamic category list
//   - useCreate / useUpdate / useDelete for inline edits
//
// Drag-and-drop reorder (@dnd-kit/sortable) rewrites manual_rank in bulk
// after a drop. manual_rank is also exposed as a manual number fallback.
//
// Tier values: "Core" and "Trusted" (External tier was removed).
import { useState, useMemo } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useList, useCreate, useUpdate, useDelete, useUpdateMany, type CrudFilter } from "@refinedev/core"
import { useQueryClient } from "@tanstack/react-query"
import { linksQueryKey } from "@/lib/prefetch"
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

const TIERS = ["Core", "Trusted"]
const HEALTH = ["alive", "broken", "unknown"]

export function LinksEditor({ assetId, coingeckoId }: { assetId: string; coingeckoId?: string }) {
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
  const updateMany = useUpdateMany()
  const remove = useDelete()

  const queryClient = useQueryClient()

  const [editing, setEditing] = useState<Partial<LinkRow> | null>(null)

  // After ANY mutation to the links table, drop the server-side cache for
  // /api/links?cg=<id> (the in-memory kv lives in the Node process) and
  // invalidate the browser-side RQ cache so the showcase refetches.
  async function revalidate() {
    if (!coingeckoId) return
    try {
      await fetch("/api/admin/revalidate-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cg: coingeckoId }),
        cache: "no-store",
      })
    } catch { /* best-effort */ }
    queryClient.invalidateQueries({ queryKey: linksQueryKey(coingeckoId) })
    // Also invalidate any asset-page payload that included this row set
    queryClient.invalidateQueries({ queryKey: ["links", coingeckoId] })
  }

  // Local mirror of rows for optimistic drag preview
  const [localRows, setLocalRows] = useState<LinkRow[] | null>(null)
  const rows: LinkRow[] = useMemo(() => {
    if (!localRows) return allRows
    // Reconcile with allRows (Refine refetch might give new objects)
    const byId = new Map(allRows.map((r) => [r.id, r]))
    return localRows.map((r) => byId.get(r.id) ?? r)
  }, [allRows, localRows])

  // Category filter (client-side)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const visibleRows = useMemo(
    () => (activeCategory ? rows.filter((r) => r.category === activeCategory) : rows),
    [rows, activeCategory],
  )

  // Category counts (over full set)
  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + 1)
    return m
  }, [rows])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = visibleRows.findIndex((r) => r.id === active.id)
    const newIndex = visibleRows.findIndex((r) => r.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(visibleRows, oldIndex, newIndex)
    // Recompute full row list: replace only the visible subset
    const fullReordered: LinkRow[] = activeCategory
      ? (() => {
          const others = rows.filter((r) => r.category !== activeCategory)
          return [...others, ...reordered]
        })()
      : reordered

    setLocalRows(fullReordered)

    // Bulk rewrite manual_rank: 10, 20, 30...
    try {
      await updateMany.mutateAsync({
        resource: "links",
        ids: reordered.map((r) => r.id),
        values: reordered.map((r, i) => ({ id: r.id, manual_rank: (i + 1) * 10 })) as never,
      })
      await revalidate()
    } finally {
      setLocalRows(null)
    }
  }

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
    await revalidate()
    setEditing(null)
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить ссылку?")) return
    await remove.mutateAsync({ resource: "links", id })
    await revalidate()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Ссылки ({rows.length})</h3>
        <button
          onClick={() => setEditing({ asset_id: assetId, tier: "Trusted", category: "tools", health: "alive", is_top: false })}
          className="px-3 py-1.5 rounded border text-sm cursor-pointer"
        >
          + Добавить ссылку
        </button>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 text-xs rounded border cursor-pointer ${!activeCategory ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
        >
          Все <span className="text-[var(--text-mut)]">({rows.length})</span>
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
            className={`px-2.5 py-1 text-xs rounded border cursor-pointer ${activeCategory === cat.key ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
          >
            {cat.icon ? `${cat.icon} ` : ""}{cat.label}
            {catCounts.get(cat.key) != null && (
              <span className="text-[var(--text-mut)] ml-1">({catCounts.get(cat.key)})</span>
            )}
          </button>
        ))}
      </div>

      {err?.message && <div className="text-sm text-rose-600">{err.message}</div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleRows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="border rounded divide-y">
            {query.isLoading && (
              <div className="px-3 py-3 text-sm text-[var(--text-mut)]">загрузка…</div>
            )}
            {!query.isLoading && visibleRows.length === 0 && (
              <div className="px-3 py-3 text-sm text-[var(--text-mut)]">пусто</div>
            )}
            {visibleRows.map((r) => (
              <SortableRow
                key={r.id}
                row={r}
                category={categoryMap.get(r.category)}
                onEdit={() => setEditing(r)}
                onDelete={() => onDelete(r.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
              <button onClick={submit} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm cursor-pointer">Сохранить</button>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border text-sm cursor-pointer">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SortableRow({
  row,
  category,
  onEdit,
  onDelete,
}: {
  row: LinkRow
  category: Category | undefined
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const imgSrc = row.icon ?? faviconUrl(row.href)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 text-sm bg-[var(--surface)]"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing touch-none"
        aria-label="Перетащить"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" />
        </svg>
      </button>
      {imgSrc && <img src={imgSrc} alt="" className="w-4 h-4" />}
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{row.name}</div>
        <div className="truncate text-xs text-[var(--text-mut)]">{row.href}</div>
      </div>
      <span className="text-xs px-1.5 py-0.5 rounded border">{row.tier}</span>
      <span className="text-xs px-1.5 py-0.5 rounded border text-[var(--text-mut)]">
        {category ? `${category.icon ?? ""} ${category.label}` : row.category}
      </span>
      {row.is_top && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200/40">top</span>}
      <button onClick={onEdit} className="text-xs text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer" aria-label="Редактировать">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button onClick={onDelete} className="text-xs text-rose-600 hover:text-rose-500 cursor-pointer">×</button>
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
