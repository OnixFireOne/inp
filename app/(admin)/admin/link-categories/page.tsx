"use client"
// app/(admin)/admin/link-categories/page.tsx
// CRUD screen for link_categories.
//
// Aspect 8 changes:
//   - DnD reorder is GLOBAL-ONLY (TЗ §8.5; per-coin order is governed by
//     assets.category_orders and lives outside this screen).
//   - The numeric `sort` field is hidden in the UI; the field is still
//     persisted in the DB (drag writes 10, 20, 30... via rerankWithinScope).
//   - "Up/down" arrows are gone — order is drag-and-drop only.
//
// Per-coin rows are shown as read-only entries (label/icon), grouped by their
// owning asset. They can still be created/edited/deleted through the modal,
// but their sort is not exposed.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
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
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core"
import { adminFetch } from "@/lib/admin/fetch"
import { rerankWithinScope } from "@/lib/links/dnd-rank"

type Category = {
  key: string
  label: string
  icon: string | null
  sort: number
  asset_id: string | null
}

type AssetPick = {
  id: string
  name: string
  ticker: string | null
  coingecko_id: string
}

export default function LinkCategoriesPage() {
  const router = useRouter()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Single list, both global and per-coin. We bucket in memory below.
  const { query } = useList<Category>({
    resource: "link_categories",
    sorters: [
      { field: "asset_id", order: "asc" },
      { field: "sort", order: "asc" },
    ],
  })

  // dnd-kit requires string ids; `link_categories.key` is unique within the
  // table (no asset_id collisions because global vs per-coin are bucketed
  // visually but stored side-by-side). For per-coin entries we additionally
  // namespace the dnd id as `asset:key` to avoid collisions if a global and a
  // per-coin ever share the same `key`.
  const dndId = (r: Category) => (r.asset_id ? `${r.asset_id}:${r.key}` : r.key)

  const assetsQuery = useList<AssetPick>({
    resource: "assets",
    pagination: { currentPage: 1, pageSize: 5000, mode: "server" },
  })
  const assetById = useMemo(() => {
    const m = new Map<string, AssetPick>()
    for (const a of assetsQuery.query.data?.data ?? []) m.set(a.id, a)
    return m
  }, [assetsQuery.query.data])

  const create = useCreate()
  const update = useUpdate()
  const remove = useDelete()

  const [editing, setEditing] = useState<Partial<Category> | null>(null)
  const [saving, setSaving] = useState(false)
  const [localGlobal, setLocalGlobal] = useState<Category[] | null>(null)

  const allRows = (query.data?.data ?? []) as Category[]
  const globalRows: Category[] = useMemo(() => {
    if (localGlobal) return localGlobal
    return allRows
      .filter((r) => r.asset_id == null)
      .slice()
      .sort((a, b) => a.sort - b.sort)
  }, [allRows, localGlobal])

  // Reconcile local mirror on every refetch.
  useEffect(() => {
    setLocalGlobal(null)
  }, [allRows])

  const perCoinRows = useMemo(
    () => allRows.filter((r) => r.asset_id != null),
    [allRows],
  )
  const perCoinByAsset = useMemo(() => {
    const m = new Map<string, Category[]>()
    for (const r of perCoinRows) {
      const list = m.get(r.asset_id as string) ?? []
      list.push(r)
      m.set(r.asset_id as string, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.sort - b.sort)
    return m
  }, [perCoinRows])

  const err = query.error as { message?: string } | null

  async function submit() {
    if (!editing) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        label: editing.label,
        icon: editing.icon ?? null,
        // Hide the field in the UI; on create the DB default (0) is fine —
        // new globals land at the end of the bucket on the next drag.
        // (New per-coin rows keep the user-assigned sort if set explicitly.)
        sort: typeof editing.sort === "number" ? editing.sort : 0,
        asset_id: editing.asset_id && editing.asset_id.length > 0 ? editing.asset_id : null,
      }
      if (editing.key) {
        await update.mutateAsync({ resource: "link_categories", id: editing.key, values: payload })
      } else {
        await create.mutateAsync({ resource: "link_categories", values: { key: editing.key, ...payload } })
      }
      // Mutations on the categories table bump v (links:cache_version).
      try {
        await adminFetch("/api/admin/invalidate-link-caches", { method: "POST" })
      } catch {
        /* best-effort */
      }
      setEditing(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(key: string) {
    if (!confirm("Удалить категорию?")) return
    await remove.mutateAsync({ resource: "link_categories", id: key })
    try {
      await adminFetch("/api/admin/invalidate-link-caches", { method: "POST" })
    } catch {
      /* best-effort */
    }
  }

  async function onGlobalDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = globalRows.findIndex((r) => dndId(r) === active.id)
    const newIndex = globalRows.findIndex((r) => dndId(r) === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(globalRows, oldIndex, newIndex)
    setLocalGlobal(reordered)
    const withNewSort = rerankWithinScope<Category & { scope: string }>(
      reordered.map((r) => ({ ...r, scope: "global" })),
      "scope",
    )
    await Promise.all(
      withNewSort.map((r) =>
        update.mutateAsync({
          resource: "link_categories",
          id: r.key,
          values: { sort: r.sort },
        }),
      ),
    )
    try {
      await adminFetch("/api/admin/invalidate-link-caches", { method: "POST" })
    } catch {
      /* best-effort */
    }
  }

  function scopeLabel(row: Category): string {
    if (!row.asset_id) return "Global"
    const a = assetById.get(row.asset_id)
    return a ? a.ticker || a.name : row.asset_id.slice(0, 8)
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4 max-w-4xl mx-auto">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push("/admin/catalog")}
              className="text-sm text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer mb-1"
            >
              ← Каталог
            </button>
            <h1 className="text-xl font-medium">Категории ссылок</h1>
            <p className="text-sm text-[var(--text-mut)]">
              Глобальные категории сортируются drag-and-drop. Per-coin категории только
              показываются здесь; их порядок управляется на странице монеты.
            </p>
          </div>
          <button
            onClick={() => setEditing({ asset_id: null })}
            className="px-3 py-1.5 rounded border text-sm"
          >
            + Добавить
          </button>
        </header>

        {err?.message && <div className="text-sm text-rose-600 mb-3">{err.message}</div>}

        {/* Global — drag-and-drop sortable list */}
        <section className="mb-8">
          <h2 className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2">
            Global ({globalRows.length})
          </h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGlobalDragEnd}>
            <SortableContext items={globalRows.map((r) => dndId(r))} strategy={verticalListSortingStrategy}>
              <ul className="border rounded-lg divide-y">
                {globalRows.length === 0 ? (
                  <li className="px-3 py-4 text-sm text-[var(--text-mut)]">пусто</li>
                ) : (
                  globalRows.map((r) => (
                    <CategoryRow
                      key={r.key}
                      row={r}
                      onEdit={() => setEditing(r)}
                      onDelete={() => onDelete(r.key)}
                    />
                  ))
                )}
              </ul>
            </SortableContext>
          </DndContext>
        </section>

        {/* Per-coin — read-only, grouped by asset */}
        {perCoinByAsset.size > 0 && (
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-wide text-[var(--text-mut)] mb-2">
              Per-coin ({perCoinRows.length})
            </h2>
            <div className="space-y-4">
              {Array.from(perCoinByAsset.entries()).map(([assetId, rows]) => {
                const a = assetById.get(assetId)
                const title = a ? `${a.ticker ?? a.name} (${a.name})` : assetId
                return (
                  <div key={assetId} className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 text-xs uppercase bg-[var(--surface)] text-[var(--text-mut)]">
                      {title}
                    </div>
                    <ul className="divide-y">
                      {rows.map((r) => (
                        <li key={r.key} className="px-3 py-2 text-sm flex items-center gap-3">
                          <span className="w-5 text-center">{r.icon ?? ""}</span>
                          <span className="font-mono text-xs">{r.key}</span>
                          <span className="flex-1">{r.label}</span>
                          <button
                            onClick={() => setEditing(r)}
                            className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer mr-2"
                            aria-label="Редактировать"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => onDelete(r.key)}
                            className="text-xs text-rose-600 hover:text-rose-500 cursor-pointer"
                            aria-label="Удалить"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] rounded-xl w-full max-w-sm p-5 space-y-3">
            <h4 className="font-medium">{editing.key ? "Редактировать категорию" : "Новая категория"}</h4>
            <div className="space-y-3 text-sm">
              <Field label="key (slug)">
                <input
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.key ?? ""}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                  disabled={!!editing.key}
                  placeholder="trade, chart, …"
                />
              </Field>
              <Field label="label (отображение)">
                <input
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.label ?? ""}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Биржи / трейд"
                />
              </Field>
              <Field label="icon (emoji или текст)">
                <input
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.icon ?? ""}
                  onChange={(e) => setEditing({ ...editing, icon: e.target.value || null })}
                  placeholder="💰"
                />
              </Field>
              <Field label="Монета (asset) — пусто = глобальная">
                <select
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.asset_id ?? ""}
                  onChange={(e) => setEditing({ ...editing, asset_id: e.target.value || null })}
                >
                  <option value="">— Глобальная —</option>
                  {(assetsQuery.query.data?.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ticker ? `${a.ticker} (${a.name})` : a.name} — {a.coingecko_id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={submit}
                disabled={saving}
                className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
              >
                {saving ? "…" : "Сохранить"}
              </button>
              <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border text-sm">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function CategoryRow({
  row,
  onEdit,
  onDelete,
}: {
  row: Category
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.asset_id ? `${row.asset_id}:${row.key}` : row.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 px-3 py-2 text-sm bg-[var(--surface)]">
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
      <span className="w-5 text-center">{row.icon ?? ""}</span>
      <span className="font-mono text-xs">{row.key}</span>
      <span className="flex-1">{row.label}</span>
      <button onClick={onEdit} className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer mr-2" aria-label="Редактировать">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button onClick={onDelete} className="text-xs text-rose-600 hover:text-rose-500 cursor-pointer">×</button>
    </li>
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