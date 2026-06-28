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
import { adminFetch, AdminForbiddenError } from "@/lib/admin/fetch"

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
  asset_id: string | null
}

const TIERS = ["Core", "Trusted"]
const HEALTH = ["alive", "broken", "unknown"]

export function LinksEditor({ assetId, coingeckoId }: { assetId: string; coingeckoId?: string }) {
  // --- categories from DB, scoped to this asset ---
  // We must NOT include per-coin categories from OTHER coins; otherwise
  // category_orders from other assets' unique categories would bleed in.
  // Supabase data provider maps CrudOperators: "null" → PostgREST `is`,
  // and the "or" ConditionalFilter → `or=(...)`.
  const catQuery = useList<Category>({
    resource: "link_categories",
    filters: [
      {
        operator: "or",
        value: [
          { field: "asset_id", operator: "null", value: "null" },
          { field: "asset_id", operator: "eq", value: assetId },
        ],
      },
    ],
    sorters: [{ field: "sort", order: "asc" }],
    pagination: { mode: "off" },
    queryOptions: { enabled: !!assetId },
  })
  const categories = (catQuery.query.data?.data ?? []) as Category[]
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

  const allRows = (result.data ?? []) as LinkRow[]
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
      // 401/403 are handled by adminFetch (redirect to signin / throw).
      // Other failures are best-effort: we still invalidate the RQ cache so
      // the showcase reflects whatever the server has.
      await adminFetch("/api/admin/revalidate-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cg: coingeckoId }),
      })
    } catch (e) {
      if (e instanceof AdminForbiddenError) return
      /* best-effort for everything else */
    }
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
        <div className="px-3 pb-3 space-y-3">
          <AssetCategoryCreator
            assetId={assetId}
            coingeckoId={coingeckoId}
            existingCategories={categories}
            onCreated={() => {
              // Pull the new per-coin category into the list (and the order
              // editor) without a full page reload.
              catQuery.query.refetch()
              // Bust the /api/links KV cache so the showcase reflects the
              // new category on the next drawer open.
              adminFetch("/api/admin/invalidate-link-caches", { method: "POST" }).catch(
                () => {},
              )
            }}
          />
          <CategoryOrderEditor
            assetId={assetId}
            coingeckoId={coingeckoId}
            categories={categories}
            queryClient={queryClient}
            linkCounts={Object.fromEntries(catCounts)}
            refetchCats={() => {
              catQuery.query.refetch()
            }}
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
  linkCounts,
  refetchCats,
}: {
  assetId: string
  coingeckoId: string | undefined
  categories: Category[]
  queryClient: ReturnType<typeof useQueryClient>
  linkCounts: Record<string, number>
  refetchCats: () => void
}) {
  // ----- Lazy load of assets.category_orders (no extra fetch: read RQ cache) -----
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [overridesLoaded, setOverridesLoaded] = useState(false)

  useEffect(() => {
    if (!coingeckoId) {
      setOverridesLoaded(true)
      return
    }
    const cached = queryClient.getQueryData<{ asset?: AssetRowSummary | null }>(
      linksQueryKey(coingeckoId),
    )
    const o = cached?.asset?.category_orders ?? null
    setOverrides(o && typeof o === "object" ? { ...o } : {})
    setOverridesLoaded(true)
  }, [coingeckoId, queryClient])

  // ----- Optimistic ordered list (local mirror, like localRows upstream) -----
  // Derived from server `categories` + `overrides`. Keys uniquely identify rows.
  const [ordered, setOrdered] = useState<Category[] | null>(null)

  // Reconcile server data → local mirror. Server wins on conflict, but we keep
  // the user's local order if it matches the server's keys (the case after
  // a successful save: server returns rows in the same order).
  const orderedCats: Category[] = useMemo(() => {
    const sortedServer = [...categories].sort((a, b) => {
      const ao = overrides[a.key] ?? a.sort
      const bo = overrides[b.key] ?? b.sort
      return ao - bo
    })
    if (!ordered) return sortedServer
    // If categories changed (create/delete) reconcile by keys.
    const byKey = new Map(sortedServer.map((c) => [c.key, c]))
    const localKeys = ordered.map((c) => c.key)
    const serverKeys = sortedServer.map((c) => c.key)
    const sameSet =
      localKeys.length === serverKeys.length &&
      localKeys.every((k, i) => k === serverKeys[i])
    if (sameSet) return sortedServer // local order already matches server
    // Rebuild: keep order of `ordered` for keys still present, append new ones.
    const seen = new Set<string>()
    const out: Category[] = []
    for (const c of ordered) {
      const fresh = byKey.get(c.key)
      if (fresh && !seen.has(c.key)) {
        out.push(fresh)
        seen.add(c.key)
      }
    }
    for (const c of sortedServer) {
      if (!seen.has(c.key)) {
        out.push(c)
        seen.add(c.key)
      }
    }
    return out
  }, [categories, overrides, ordered])

  // Once overrides first load, seed the mirror so future dragging is local-only.
  useEffect(() => {
    if (overridesLoaded && !ordered) {
      // seed from a stable sort by effective sort so initial render is correct
      const seeded = [...categories].sort((a, b) => {
        const ao = overrides[a.key] ?? a.sort
        const bo = overrides[b.key] ?? b.sort
        return ao - bo
      })
      setOrdered(seeded)
    }
  }, [overridesLoaded, ordered, categories, overrides])

  // ----- Save status -----
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ----- dnd-kit -----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // After every successful save → server fetch in the parent. We re-derive
  // orderedCats from server (above) which will reconcile.
  async function persistOrder(newOrder: Category[]) {
    if (!coingeckoId) {
      setError("Не указан coingecko_id актива")
      return false
    }
    // Build category_orders map covering ONLY categories in the new order.
    // (Глобальные и персональные категории могут интерливиться — пишем порядок
    // для ВСЕХ категорий монеты, чтобы locked-sort не сломался при добавлении
    // новых глобальных.)
    const orders: Record<string, number> = {}
    newOrder.forEach((c, i) => {
      // include both global and per-asset categories in the override map
      orders[c.key] = (i + 1) * 10
    })

    // snapshot for rollback
    const prev = orderedCats
    const prevOverrides = overrides
    setOrdered(newOrder)
    setOverrides(orders)

    setSaving(true)
    setError(null)
    try {
      const r = await adminFetch("/api/admin/asset-category-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: assetId,
          coingecko_id: coingeckoId,
          category_orders: orders,
        }),
      })
      if (!r.ok) {
        const text = await r.text()
        throw new Error(text || `HTTP ${r.status}`)
      }
      // Drop the per-asset KV mirrors + invalidate client cache so the
      // showcase reflects the new order.
      try {
        await adminFetch("/api/admin/revalidate-links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cg: coingeckoId }),
        })
      } catch { /* best effort */ }
      await queryClient.invalidateQueries({ queryKey: linksQueryKey(coingeckoId) })
      return true
    } catch (e) {
      if (e instanceof AdminForbiddenError) {
        setError("Недостаточно прав")
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
      // rollback
      setOrdered(prev)
      setOverrides(prevOverrides)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = orderedCats.findIndex((c) => c.key === active.id)
    const newIndex = orderedCats.findIndex((c) => c.key === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(orderedCats, oldIndex, newIndex)
    await persistOrder(next)
  }

  function move(key: string, dir: -1 | 1) {
    const idx = orderedCats.findIndex((c) => c.key === key)
    if (idx < 0) return
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= orderedCats.length) return
    const next = arrayMove(orderedCats, idx, swapIdx)
    setOrdered(next)
    setError(null)
    void persistOrder(next)
  }

  // ----- Edit / Delete of per-asset (unique) categories -----
  const updateCategory = useUpdate()
  const deleteCategory = useDelete()

  async function saveEdit(c: Category, label: string, icon: string | null) {
    try {
      await updateCategory.mutateAsync({
        resource: "link_categories",
        id: c.key,
        values: { label: label.trim(), icon },
      })
      refetchCats()
      try {
        await adminFetch("/api/admin/invalidate-link-caches", { method: "POST" })
      } catch { /* best-effort */ }
      await queryClient.invalidateQueries({ queryKey: linksQueryKey(coingeckoId ?? "") })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка редактирования")
    }
  }

  async function deleteUnique(c: Category) {
    const count = linkCounts[c.key] ?? 0
    if (count > 0) {
      setError(
        `Нельзя удалить «${c.label}»: сначала перенесите ${count} ссыл${count === 1 ? "у" : count < 5 ? "ки" : "ок"} в другую категорию.`,
      )
      return
    }
    if (!confirm(`Удалить категорию «${c.label}»? Это действие необратимо.`)) return
    try {
      await deleteCategory.mutateAsync({ resource: "link_categories", id: c.key })
      refetchCats()
      try {
        await adminFetch("/api/admin/invalidate-link-caches", { method: "POST" })
      } catch { /* best-effort */ }
      await queryClient.invalidateQueries({ queryKey: linksQueryKey(coingeckoId ?? "") })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка удаления")
    }
  }

  if (!categories.length) return null

  return (
    <div className="border rounded-lg bg-[var(--surface)] p-3 space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={orderedCats.map((c) => c.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-y border rounded">
            {orderedCats.map((c, i) => {
              const isGlobal = c.asset_id == null
              const isUnique = !isGlobal
              return (
                <SortableCategoryRow
                  key={c.key}
                  category={c}
                  index={i}
                  total={orderedCats.length}
                  isFirst={i === 0}
                  isLast={i === orderedCats.length - 1}
                  isGlobal={isGlobal}
                  isUnique={isUnique}
                  linkCount={linkCounts[c.key] ?? 0}
                  saving={saving}
                  onMove={(dir) => move(c.key, dir)}
                  onSaveEdit={(label, icon) => saveEdit(c, label, icon)}
                  onDelete={isUnique ? () => deleteUnique(c) : undefined}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="text-[11px] text-[var(--text-mut)] flex flex-wrap gap-2 items-center">
        <span>Стрелки ↑/↓ и drag меняют порядок категорий для этого актива (сохраняется автоматически).</span>
        {error && <span className="text-rose-600">{error}</span>}
      </div>
    </div>
  )
}

// -------------------------------------------------------------
// Sortable row for a single category in the order editor.
// Global categories are read-only (no edit/delete buttons).
// -------------------------------------------------------------
function SortableCategoryRow({
  category,
  index,
  isFirst,
  isLast,
  isGlobal,
  isUnique,
  linkCount,
  saving,
  onMove,
  onSaveEdit,
  onDelete,
}: {
  category: Category
  index: number
  total: number
  isFirst: boolean
  isLast: boolean
  isGlobal: boolean
  isUnique: boolean
  linkCount: number
  saving: boolean
  onMove: (dir: -1 | 1) => void
  onSaveEdit: (label: string, icon: string | null) => Promise<void>
  onDelete?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.key })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [editing, setEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(category.label)
  const [editIcon, setEditIcon] = useState<string>(category.icon ?? "")
  const [savingEdit, setSavingEdit] = useState(false)

  // Re-sync draft if the row changes while the form is closed.
  useEffect(() => {
    if (!editing) {
      setEditLabel(category.label)
      setEditIcon(category.icon ?? "")
    }
  }, [category.label, category.icon, editing])

  async function saveEdit() {
    setSavingEdit(true)
    try {
      await onSaveEdit(editLabel, editIcon.trim() ? editIcon.trim() : null)
      setEditing(false)
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 text-sm bg-[var(--surface)]"
    >
      <span className="w-6 text-right text-xs text-[var(--text-mut)] tabular-nums">{index + 1}</span>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing touch-none"
        aria-label="Перетащить категорию"
        title="Перетащить"
      >
        <svg
          width="12"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="9" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="18" r="1" />
        </svg>
      </button>
      <span className="flex-1 min-w-0 truncate">
        {category.icon && <span className="mr-1" aria-hidden>{category.icon}</span>}
        {category.label}
      </span>
      <span
        className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${isGlobal ? "text-[var(--text-mut)]" : "text-[var(--accent)] border-[var(--accent)]/30"}`}
        title={isGlobal ? "Глобальная категория (общая для всех монет)" : "Уникальная категория этой монеты"}
      >
        {isGlobal ? "global" : "этой монеты"}
      </span>
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={isFirst || saving}
        aria-label={`Поднять ${category.label}`}
        className="w-7 h-7 inline-flex items-center justify-center rounded border disabled:opacity-30 cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={isLast || saving}
        aria-label={`Опустить ${category.label}`}
        className="w-7 h-7 inline-flex items-center justify-center rounded border disabled:opacity-30 cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isUnique && (
        <>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-label="Редактировать категорию"
            title="Редактировать"
            className="w-7 h-7 inline-flex items-center justify-center rounded border cursor-pointer text-[var(--text-mut)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Удалить категорию"
              title={linkCount > 0 ? `Нельзя удалить (${linkCount} ссыл${linkCount === 1 ? "а" : linkCount < 5 ? "и" : ""})` : "Удалить"}
              disabled={saving}
              className="w-7 h-7 inline-flex items-center justify-center rounded border cursor-pointer text-rose-600 disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          )}
        </>
      )}
      {editing && (
        <div className="basis-full mt-2 ml-8 flex flex-wrap items-end gap-2 rounded border border-[var(--border)] p-2 bg-[var(--bg)]/40">
          <label className="text-xs flex flex-col gap-1">
            <span className="text-[var(--text-mut)]">Название</span>
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="border rounded px-2 py-1 bg-[var(--surface)]"
            />
          </label>
          <label className="text-xs flex flex-col gap-1">
            <span className="text-[var(--text-mut)]">Иконка</span>
            <input
              value={editIcon}
              onChange={(e) => setEditIcon(e.target.value)}
              placeholder="🟠"
              className="border rounded px-2 py-1 w-20 bg-[var(--surface)]"
            />
          </label>
          <span className="text-[10px] text-[var(--text-mut)] font-mono pb-1">key: {category.key}</span>
          <button
            type="button"
            onClick={saveEdit}
            disabled={savingEdit}
            className="px-2.5 py-1 text-xs rounded border bg-foreground text-background disabled:opacity-50 cursor-pointer"
          >
            {savingEdit ? "..." : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setEditLabel(category.label)
              setEditIcon(category.icon ?? "")
            }}
            className="px-2.5 py-1 text-xs rounded cursor-pointer"
          >
            Отмена
          </button>
        </div>
      )}
    </li>
  )
}

// =============================================================
// AssetCategoryCreator
// -------------------------------------------------------------
// Inline form to add a per-coin link category from the asset drawer.
//
// Why we namespace the key under the coin:
//   link_categories.key is a global PRIMARY KEY. A category called
//   "Ordinals" must not collide with a global "ordinals" (if one ever
//   exists) or with another coin's "Ordinals". We generate
//   `${coingeckoId}__${slug}` so the admin only types the label and we
//   own the key.
//
// Sort defaults to max+10 so the new category lands at the bottom of
// the order editor; the admin then drags it between globals (or other
// per-coin rows) — that drag writes assets.category_orders and the
// category sits wherever the override says on the showcase.
// =============================================================

function AssetCategoryCreator({
  assetId,
  coingeckoId,
  existingCategories,
  onCreated,
}: {
  assetId: string
  coingeckoId?: string
  existingCategories: Category[]
  onCreated: () => void
}) {
  const create = useCreate()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [icon, setIcon] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // key уникален глобально (PK) -> неймспейсим под монету, чтобы не словить
  // коллизию с глобальной категорией или категорией другой монеты.
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  // Prefer coingecko_id (stable, short, URL-friendly). Fall back to assetId
  // for the synthetic "all" row whose coingecko_id may equal "all".
  const prefix = (coingeckoId || assetId).slice(0, 24)
  const key = slug ? `${prefix}__${slug}` : ""

  async function submit() {
    if (!key) {
      setError("Введите название")
      return
    }
    if (existingCategories.some((c) => c.key === key)) {
      setError("Такая категория уже есть")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const maxSort = existingCategories.reduce(
        (m, c) => Math.max(m, c.sort ?? 0),
        0,
      )
      await create.mutateAsync({
        resource: "link_categories",
        values: {
          key,
          label: label.trim(),
          icon: icon.trim() || null,
          sort: maxSort + 10, // встанет в конец; позицию задашь стрелками ниже
          asset_id: assetId, // ← делает категорию уникальной для монеты
        },
      })
      onCreated()
      setLabel("")
      setIcon("")
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания")
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 text-xs rounded border cursor-pointer"
      >
        + Категория для этой монеты
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-[var(--border)] p-2">
      <label className="text-xs flex flex-col gap-1">
        <span className="text-[var(--text-mut)]">Название</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ordinals"
          className="border rounded px-2 py-1 bg-[var(--surface)]"
        />
      </label>
      <label className="text-xs flex flex-col gap-1">
        <span className="text-[var(--text-mut)]">Иконка</span>
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="🟠"
          className="border rounded px-2 py-1 w-20 bg-[var(--surface)]"
        />
      </label>
      <span className="text-[10px] text-[var(--text-mut)] font-mono pb-1">
        key: {key || "—"}
      </span>
      <button
        onClick={submit}
        disabled={saving}
        className="px-2.5 py-1 text-xs rounded border cursor-pointer"
      >
        {saving ? "..." : "Создать"}
      </button>
      <button
        onClick={() => {
          setOpen(false)
          setError(null)
        }}
        className="px-2.5 py-1 text-xs rounded cursor-pointer text-[var(--text-mut)]"
      >
        Отмена
      </button>
      {error && <span className="text-xs text-red-500 w-full">{error}</span>}
    </div>
  )
}
