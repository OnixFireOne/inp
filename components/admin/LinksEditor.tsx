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
import { useState, useMemo, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
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
import { useList, useCreate, useUpdate, useDelete, type CrudFilter } from "@refinedev/core"
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
    pagination: { mode: "off" },
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

    // Bulk rewrite manual_rank: 10, 20, 30... via individual row updates.
    // (useUpdateMany applies one values object to ALL rows — doesn't support per-row values.)
    await Promise.all(
      reordered.map((r, i) =>
        update.mutateAsync({
          resource: "links",
          id: r.id,
          values: { manual_rank: (i + 1) * 10 },
        }),
      ),
    )
    await revalidate()
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

      {/* Per-asset category sort order (category_orders). */}
      <details className="rounded border border-[var(--border)] mb-4 group">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center justify-between">
          <span>Порядок категорий для этой монеты</span>
          <span className="text-[var(--text-mut)] text-xs group-open:hidden">развернуть</span>
        </summary>
        <div className="px-3 pb-3">
          <CategoryOrderEditor
            assetId={assetId}
            coingeckoId={coingeckoId}
            categories={categories}
            queryClient={queryClient}
          />
        </div>
      </details>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 text-xs rounded border cursor-pointer ${!activeCategory ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
        >
          Все <span className="text-[var(--text-mut)]">({rows.length})</span>
        </button>
        {categories
          .filter((cat) => (catCounts.get(cat.key) ?? 0) > 0)
          .map((cat) => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(activeCategory === cat.key ? null : cat.key)}
              className={`px-2.5 py-1 text-xs rounded border cursor-pointer ${activeCategory === cat.key ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-[var(--text)]"}`}
            >
              {cat.icon ? `${cat.icon} ` : ""}{cat.label}
              <span className="text-[var(--text-mut)] ml-1">({catCounts.get(cat.key)})</span>
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

      <Dialog.Root open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2 w-[min(560px,94vw)] max-h-[88vh] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-5 drawer-scroll"
          >
            {editing && (
              <>
                <Dialog.Title className="text-base font-semibold mb-3">
                  {editing.id ? "Редактировать ссылку" : "Новая ссылка"}
                </Dialog.Title>
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
                    <input className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]" value={editing.icon ?? ""} onChange={(e) => setEditing({ ...editing, icon: e.target.value ? e.target.value : null })} placeholder="https://… (фавикон если пусто)" />
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
                <div className="flex gap-2 pt-3">
                  <button onClick={submit} className="px-3 py-1.5 rounded border bg-foreground text-background text-sm cursor-pointer">Сохранить</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border text-sm cursor-pointer">Отмена</button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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

// =============================================================
// CategoryOrderEditor
// -------------------------------------------------------------
// Per-asset category sort overrides stored in assets.category_orders (jsonb).
// Loaded lazily from the RQ-cached links payload; saved via
// POST /api/admin/asset-category-orders.
// =============================================================

interface AssetRowSummary {
  id: string
  coingecko_id: string
  category_orders?: Record<string, number> | null
}

function CategoryOrderEditor({
  assetId,
  coingeckoId,
  categories,
  queryClient,
}: {
  assetId: string
  coingeckoId: string | undefined
  categories: Category[]
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read current overrides from the RQ-cached links payload (no extra fetch).
  useEffect(() => {
    if (!coingeckoId) return
    const cached = queryClient.getQueryData<{ asset?: AssetRowSummary | null }>(
      linksQueryKey(coingeckoId),
    )
    const o = cached?.asset?.category_orders ?? null
    setOverrides(o && typeof o === "object" ? { ...o } : {})
  }, [coingeckoId, queryClient])

  // Merged view: default sort from categories table, overridden by the map.
  // Sorted ascending by effective sort.
  const view = useMemo(() => {
    const merged = categories.map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      sort: overrides[c.key] ?? c.sort,
      overridden: Object.prototype.hasOwnProperty.call(overrides, c.key),
    }))
    merged.sort((a, b) => a.sort - b.sort)
    return merged
  }, [categories, overrides])

  function move(key: string, dir: -1 | 1) {
    setOverrides((prev) => {
      const idx = view.findIndex((v) => v.key === key)
      if (idx < 0) return prev
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= view.length) return prev
      const next = [...view]
      const a = next[idx]
      const b = next[swapIdx]
      // Swap their effective sort values; persist both keys so the order is
      // locked even when a default would otherwise re-insert between them.
      next[idx] = b
      next[swapIdx] = a
      const out = { ...prev }
      out[a.key] = a.sort
      out[b.key] = b.sort
      return out
    })
    setSavedAt(null)
    setError(null)
  }

  function clearOverride(key: string) {
    setOverrides((prev) => {
      if (!(key in prev)) return prev
      const out = { ...prev }
      delete out[key]
      return out
    })
    setSavedAt(null)
    setError(null)
  }

  function clearAll() {
    setOverrides({})
    setSavedAt(null)
    setError(null)
  }

  async function save() {
    if (!coingeckoId) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("/api/admin/asset-category-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: assetId,
          coingecko_id: coingeckoId,
          category_orders: overrides,
        }),
        cache: "no-store",
      })
      if (!r.ok) {
        const text = await r.text()
        throw new Error(text || `HTTP ${r.status}`)
      }
      // Drop server KV + refetch links payload → table reflects new order.
      try {
        await fetch("/api/admin/revalidate-links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cg: coingeckoId }),
          cache: "no-store",
        })
      } catch { /* best-effort */ }
      await queryClient.invalidateQueries({ queryKey: linksQueryKey(coingeckoId) })
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!categories.length) return null

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <div className="border rounded-lg bg-[var(--surface)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clearAll}
          disabled={!hasOverrides || saving}
          className="px-2.5 py-1 text-xs rounded border disabled:opacity-40 cursor-pointer"
        >
          Сбросить
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 text-xs rounded border bg-foreground text-background disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      <ul className="divide-y border rounded">
        {view.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <span className="w-6 text-right text-xs text-[var(--text-mut)] tabular-nums">{i + 1}</span>
            <span className="flex-1 truncate">
              {c.icon && <span className="mr-1" aria-hidden>{c.icon}</span>}
              {c.label}
              {c.overridden && (
                <span className="ml-2 text-[10px] uppercase text-[var(--accent)]">custom</span>
              )}
            </span>
            <span className="text-xs text-[var(--text-mut)] tabular-nums w-12 text-right">sort {c.sort}</span>
            <button
              type="button"
              onClick={() => move(c.key, -1)}
              disabled={i === 0}
              aria-label={`Поднять ${c.label}`}
              className="w-7 h-7 inline-flex items-center justify-center rounded border disabled:opacity-30 cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => move(c.key, 1)}
              disabled={i === view.length - 1}
              aria-label={`Опустить ${c.label}`}
              className="w-7 h-7 inline-flex items-center justify-center rounded border disabled:opacity-30 cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => clearOverride(c.key)}
              disabled={!c.overridden}
              aria-label={`Сбросить порядок для ${c.label}`}
              className="w-7 h-7 inline-flex items-center justify-center rounded border disabled:opacity-30 cursor-pointer text-[var(--text-mut)]"
              title="Сбросить порядок"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4v5h5" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <div className="text-[11px] text-[var(--text-mut)] flex gap-2 items-center">
        <span>Стрелки ↑/↓ меняют индивидуальный порядок категорий для этого актива.</span>
        {savedAt && <span className="text-emerald-600">Сохранено.</span>}
        {error && <span className="text-rose-600">{error}</span>}
      </div>
    </div>
  )
}
