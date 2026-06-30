"use client"
// app/(admin)/admin/link-templates/page.tsx
// Global templates editor for generated virtual links (TЗ §7).
//
//   - Refine v5 CRUD on link_templates.
//   - Drag-and-drop reorders within a single category; sort is written as
//     10, 20, 30... automatically (no numeric field in the UI).
//   - The kind field toggles between pattern (by variables) and provider
//     (resolved against a snapshot). The opposite-kind columns are cleared
//     on submit.
//   - After any mutation or drag we call /api/admin/invalidate-template-caches
//     which bumps tv (the templates version key) — both the templates cache
//     and the storefront key (links:v{v}:t{tv}:{cg}) retires old entries.
//
// TЗ §7.5 (a) panel ("доступно, но не добавлено") is implemented below on
// the sample snapshot. TЗ §7.5 (b) (snapshot keys without a resolver) is
// surfaced via listUnresolvedSnapshotKeys() but is intentionally thin until
// the editor gains a per-coin context.

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
import { useList, useCreate, useUpdate, useDelete, type CrudFilter } from "@refinedev/core"
import { adminFetch } from "@/lib/admin/fetch"
import { LinkIcon } from "@/components/LinkIcon"
import type { LinkTemplate } from "@/lib/links/resolve"
import { applyPattern, TEMPLATE_VARS, type AssetVars } from "@/lib/links/template-vars"
import { resolveSource } from "@/lib/links/source-registry"
import type { CgMeta } from "@/lib/links/providers/coingecko/types"
import {
  providerDefaults,
  providerList,
  sourceKeyList,
} from "@/lib/links/provider-defaults"
import {
  listAvailableSources,
  listUnresolvedSnapshotKeys,
} from "@/lib/links/source-registry-diagnostics"
import { rerankWithinCategory } from "@/lib/links/dnd-rank"
import { buildTemplateSubmitValues } from "@/lib/links/build-template-submit"

type Category = {
  key: string
  label: string
  icon: string | null
  sort: number
  asset_id: string | null
}

const TIERS = ["Core", "Trusted"] as const
const SAMPLE_VARS: AssetVars = { coingecko_id: "bitcoin", ticker: "BTC" }

const SAMPLE_CG_META: CgMeta = {
  links: {
    homepage: ["https://bitcoin.org"],
    whitepaper: "https://bitcoin.org/bitcoin.pdf",
    blockchain_site: ["https://blockchair.com/bitcoin"],
    twitter_screen_name: "bitcoin",
    telegram_channel_identifier: "bitcoin",
    subreddit_url: "https://reddit.com/r/bitcoin",
    repos_url: { github: ["https://github.com/bitcoin/bitcoin"] },
    chat_url: ["https://t.me/bitcoin"],
    official_forum_url: ["https://bitcointalk.org"],
  },
}

export default function LinkTemplatesPage() {
  const router = useRouter()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Only GLOBAL categories are valid for templates (DB trigger rejects the
  // rest). Filter at the data provider layer using Supabase's PostgREST filter.
  const catFilter: CrudFilter[] = [
    { field: "asset_id", operator: "null", value: "null" },
  ]
  const categoriesQuery = useList<Category>({
    resource: "link_categories",
    filters: catFilter,
    sorters: [{ field: "sort", order: "asc" }],
    pagination: { mode: "off" },
  })
  const globalCategories = (categoriesQuery.query.data?.data ?? []) as Category[]

  const templatesQuery = useList<LinkTemplate>({
    resource: "link_templates",
    sorters: [
      { field: "category", order: "asc" },
      { field: "sort", order: "asc" },
    ],
    pagination: { mode: "off" },
  })
  const allRows = (templatesQuery.query.data?.data ?? []) as LinkTemplate[]

  const create = useCreate()
  const update = useUpdate()
  const remove = useDelete()

  const [editing, setEditing] = useState<Partial<LinkTemplate> | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // Local mirror so drag-and-drop feels instant; reconciled on every refetch.
  const [localRows, setLocalRows] = useState<LinkTemplate[] | null>(null)
  const rows: LinkTemplate[] = useMemo(() => {
    if (!localRows) return allRows
    const byId = new Map(allRows.map((r) => [r.id, r]))
    return localRows.map((r) => byId.get(r.id) ?? r)
  }, [allRows, localRows])

  const rowsByCategory = useMemo(() => {
    const m = new Map<string, LinkTemplate[]>()
    for (const r of rows) {
      const arr = m.get(r.category) ?? []
      arr.push(r)
      m.set(r.category, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort)
    return m
  }, [rows])

  const categoryKeys = useMemo(() => {
    return Array.from(rowsByCategory.keys()).sort()
  }, [rowsByCategory])

  const invalidateTv = async () => {
    try {
      await adminFetch("/api/admin/invalidate-template-caches", {
        method: "POST",
      })
    } catch {
      /* best-effort */
    }
  }

  async function submit() {
    if (!editing) return
    setSaving(true)
    try {
      const values = buildTemplateSubmitValues(editing, {
        isCreate: !editing.id,
        existingRows: rows,
      })
      if (editing.id) {
        await update.mutateAsync({
          resource: "link_templates",
          id: editing.id,
          values,
        })
      } else {
        await create.mutateAsync({
          resource: "link_templates",
          values,
        })
      }
      await invalidateTv()
      setEditing(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Удалить шаблон?")) return
    await remove.mutateAsync({ resource: "link_templates", id })
    await invalidateTv()
  }

  async function onCategoryDragEnd(cat: string, e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const bucket = rowsByCategory.get(cat) ?? []
    const oldIndex = bucket.findIndex((r) => r.id === active.id)
    const newIndex = bucket.findIndex((r) => r.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(bucket, oldIndex, newIndex)
    const others = rows.filter((r) => r.category !== cat)
    setLocalRows([...others, ...reordered])

    await Promise.all(
      reordered.map((r, i) =>
        update.mutateAsync({
          resource: "link_templates",
          id: r.id,
          values: { sort: (i + 1) * 10 },
        }),
      ),
    )
    await invalidateTv()
  }

  function startCreate() {
    setEditing({
      kind: "pattern",
      enabled: true,
      category: activeCategory ?? globalCategories[0]?.key ?? null,
      label: "",
      icon: "",
      url_pattern: "",
      tier: "Trusted",
    })
  }

  const availableSources = useMemo(
    () => listAvailableSources("coingecko", rows, SAMPLE_CG_META),
    [rows],
  )
  const unresolvedKeys = useMemo(
    () => listUnresolvedSnapshotKeys(SAMPLE_CG_META),
    [],
  )

  function startCreateFromAvailable(provider: string, sourceKey: string) {
    const def = providerDefaults(provider, sourceKey)
    if (!def) return
    setEditing({
      kind: "provider",
      enabled: true,
      provider,
      source_key: sourceKey,
      label: def.label,
      icon: def.icon,
      category: def.category,
      tier: def.tier,
    })
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="px-4 pt-4 max-w-5xl mx-auto">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <button
              onClick={() => router.push("/admin/catalog")}
              className="text-sm text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer mb-1"
            >
              ← Каталог
            </button>
            <h1 className="text-xl font-medium">Шаблоны ссылок</h1>
            <p className="text-sm text-[var(--text-mut)]">
              Глобальные правила генерации виртуальных ссылок (pattern по переменным, provider — из снимка CG).
              Порядок — только drag-and-drop; sort пишется автоматически.
            </p>
          </div>
          <button
            onClick={startCreate}
            className="px-3 py-1.5 rounded border text-sm"
          >
            + Добавить шаблон
          </button>
        </header>

        {/* category chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Chip active={activeCategory === null} onClick={() => setActiveCategory(null)}>
            Все
          </Chip>
          {categoryKeys.map((k) => (
            <Chip key={k} active={activeCategory === k} onClick={() => setActiveCategory(k)}>
              {k} ({rowsByCategory.get(k)?.length ?? 0})
            </Chip>
          ))}
        </div>

        {templatesQuery.query.error && (
          <div className="text-sm text-rose-600 mb-3">
            {String((templatesQuery.query.error as unknown as Error).message ?? templatesQuery.query.error)}
          </div>
        )}

        {/* per-category sortable lists */}
        <div className="space-y-6">
          {categoryKeys
            .filter((k) => activeCategory === null || activeCategory === k)
            .map((cat) => {
              const bucket = rowsByCategory.get(cat) ?? []
              return (
                <CategoryBucket
                  key={cat}
                  category={cat}
                  rows={bucket}
                  onDragEnd={(e) => onCategoryDragEnd(cat, e)}
                  onEdit={(r) => setEditing(r)}
                  onDelete={onDelete}
                  sensors={sensors}
                />
              )
            })}
          {categoryKeys.length === 0 && !templatesQuery.query.isLoading && (
            <div className="text-sm text-[var(--text-mut)]">Пока нет шаблонов.</div>
          )}
        </div>

        {/* TЗ §7.5 (a) — available, but not added. Sample snapshot only. */}
        <section className="mt-10">
          <h2 className="text-sm font-medium mb-2">Доступно, но не добавлено</h2>
          <p className="text-xs text-[var(--text-mut)] mb-3">
            Источники из реестра (coingecko), которые резолвятся на сэмпле, но для которых ещё нет включённого шаблона.
            Превью и добавление с дефолтами.
          </p>
          {availableSources.length === 0 ? (
            <div className="text-xs text-[var(--text-mut)]">Нет доступных источников на сэмпле.</div>
          ) : (
            <ul className="border rounded-lg divide-y">
              {availableSources.map((s) => (
                <li key={`${s.provider}:${s.sourceKey}`} className="px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="text-base">{s.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{s.label}</div>
                    <div className="truncate text-xs text-[var(--text-mut)]">{s.previewUrl}</div>
                  </div>
                  <button
                    onClick={() => startCreateFromAvailable(s.provider, s.sourceKey)}
                    className="text-xs px-2 py-1 rounded border"
                  >
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* TЗ §7.5 (b) — diagnostic: snapshot keys without a resolver. */}
        <section className="mt-8 mb-12">
          <h2 className="text-sm font-medium mb-2">Неизвестные ключи снимка (нужен код)</h2>
          <p className="text-xs text-[var(--text-mut)] mb-3">
            Поля из snapshot, для которых нет резолвера в SOURCE_REGISTRY. На сэмпле обычно пусто.
            На per-coin snapshot появится реальный список — и понадобится код резолвера (TЗ №11).
          </p>
          {unresolvedKeys.length === 0 ? (
            <div className="text-xs text-[var(--text-mut)]">Все ключи покрыты.</div>
          ) : (
            <div className="text-xs font-mono">{unresolvedKeys.join(", ")}</div>
          )}
        </section>
      </div>

      {editing && (
        <TemplateModal
          editing={editing}
          setEditing={setEditing}
          saving={saving}
          onSubmit={submit}
          onClose={() => setEditing(null)}
          globalCategories={globalCategories}
        />
      )}
    </main>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded border ${active ? "bg-[var(--surface)] border-[var(--accent)]" : "border-transparent text-[var(--text-mut)] hover:text-foreground"}`}
    >
      {children}
    </button>
  )
}

function CategoryBucket({
  category,
  rows,
  onDragEnd,
  onEdit,
  onDelete,
  sensors,
}: {
  category: string
  rows: LinkTemplate[]
  onDragEnd: (e: DragEndEvent) => void
  onEdit: (r: LinkTemplate) => void
  onDelete: (id: string) => void
  sensors: ReturnType<typeof useSensors>
}) {
  return (
    <section>
      <h3 className="text-xs uppercase text-[var(--text-mut)] mb-2">{category}</h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="border rounded-lg divide-y">
            {rows.map((r) => (
              <TemplateRow key={r.id} row={r} onEdit={() => onEdit(r)} onDelete={() => onDelete(r.id)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function TemplateRow({
  row,
  onEdit,
  onDelete,
}: {
  row: LinkTemplate
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const source =
    row.kind === "pattern"
      ? row.url_pattern
      : row.provider && row.source_key
        ? `${row.provider}:${row.source_key}`
        : "—"
  const iconHref =
    row.kind === "pattern"
      ? row.url_pattern ?? ""
      : row.provider && row.source_key
        ? resolveSource(row.provider, row.source_key, SAMPLE_CG_META) ?? ""
        : ""
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
      <span className="w-6 flex justify-center">
        <LinkIcon
          href={iconHref}
          icon={row.icon}
          name={row.label || row.source_key || "—"}
          size={20}
        />
      </span>
      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border">{row.kind}</span>
      <span className="flex-1 min-w-0">
        <span className="font-medium">{row.label || "(без названия)"}</span>
        <span className="block truncate text-xs text-[var(--text-mut)]">{source}</span>
      </span>
      <span className="text-xs px-1.5 py-0.5 rounded border">{row.tier}</span>
      <span
        className={`text-xs px-1.5 py-0.5 rounded border ${row.enabled ? "border-emerald-300 text-emerald-700" : "border-zinc-300 text-zinc-500"}`}
      >
        {row.enabled ? "on" : "off"}
      </span>
      <button onClick={onEdit} className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer" aria-label="Редактировать">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button onClick={onDelete} className="text-xs text-rose-600 hover:text-rose-500 cursor-pointer">×</button>
    </li>
  )
}

function TemplateModal({
  editing,
  setEditing,
  saving,
  onSubmit,
  onClose,
  globalCategories,
}: {
  editing: Partial<LinkTemplate>
  setEditing: React.Dispatch<React.SetStateAction<Partial<LinkTemplate> | null>>
  saving: boolean
  onSubmit: () => void
  onClose: () => void
  globalCategories: Category[]
}) {
  const isCreate = !editing.id
  const kind = editing.kind === "provider" ? "provider" : "pattern"

  // Provider prefill (TЗ §7.4): only on create or when fields are empty.
  useEffect(() => {
    if (kind !== "provider") return
    const def = providerDefaults(editing.provider ?? "", editing.source_key ?? "")
    if (!def) return
    setEditing((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      const setIfEmpty = <K extends keyof LinkTemplate>(field: K, value: LinkTemplate[K]) => {
        const cur = next[field]
        if (cur === undefined || cur === null || cur === "") next[field] = value
      }
      if (isCreate) {
        setIfEmpty("label", def.label)
        setIfEmpty("icon", def.icon)
        setIfEmpty("category", def.category)
        setIfEmpty("tier", def.tier)
      } else {
        setIfEmpty("label", def.label)
        setIfEmpty("icon", def.icon)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.provider, editing.source_key, kind, isCreate])

  const previewUrl: string | null = (() => {
    if (kind === "pattern" && editing.url_pattern) {
      return applyPattern(editing.url_pattern, SAMPLE_VARS)
    }
    if (kind === "provider" && editing.provider && editing.source_key) {
      return resolveSource(editing.provider, editing.source_key, SAMPLE_CG_META)
    }
    return null
  })()
  const previewBroken =
    kind === "pattern" && !!editing.url_pattern && previewUrl === null
  const previewIcon =
    editing.icon ??
    (kind === "provider"
      ? providerDefaults(editing.provider ?? "", editing.source_key ?? "")?.icon ?? null
      : null)
  const previewName =
    editing.label ||
    (kind === "provider" ? editing.source_key || "preview" : "preview")

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] rounded-xl w-full max-w-2xl p-5 space-y-4">
        <h4 className="font-medium">{isCreate ? "Новый шаблон" : "Редактировать шаблон"}</h4>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Kind">
            <select
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              value={kind}
              onChange={(e) =>
                setEditing({ ...editing, kind: e.target.value as "pattern" | "provider" })
              }
            >
              <option value="pattern">pattern</option>
              <option value="provider">provider</option>
            </select>
          </Field>
          <Field label="Категория (только глобальные)">
            <select
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              value={editing.category ?? ""}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            >
              <option value="">— выбрать —</option>
              {globalCategories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.key} {c.icon ? ` ${c.icon}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label (можно {symbol})">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              value={editing.label ?? ""}
              onChange={(e) => setEditing({ ...editing, label: e.target.value })}
            />
          </Field>
          <Field label="Icon (emoji или URL)">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              value={editing.icon ?? ""}
              onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
              placeholder="🦎 или https://..."
            />
          </Field>
          <Field label="Tier">
            <select
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              value={editing.tier ?? "Trusted"}
              onChange={(e) => setEditing({ ...editing, tier: e.target.value as "Core" | "Trusted" })}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Enabled">
            <label className="inline-flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={editing.enabled ?? true}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
              <span className="text-xs text-[var(--text-mut)]">включён</span>
            </label>
          </Field>

          {kind === "pattern" ? (
            <div className="col-span-2">
              <Field label="URL pattern">
                <input
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)] font-mono"
                  value={editing.url_pattern ?? ""}
                  onChange={(e) => setEditing({ ...editing, url_pattern: e.target.value })}
                  placeholder="https://www.coingecko.com/en/coins/{slug}"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(TEMPLATE_VARS).map(([name, def]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          url_pattern: `${editing.url_pattern ?? ""}{${name}}`,
                        })
                      }
                      className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
                      title={def.desc}
                    >
                      {`{${name}}`}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ) : (
            <>
              <Field label="Provider">
                <select
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.provider ?? ""}
                  onChange={(e) => setEditing({ ...editing, provider: e.target.value, source_key: "" })}
                >
                  <option value="">— выбрать —</option>
                  {providerList().map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Source key">
                <select
                  className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                  value={editing.source_key ?? ""}
                  onChange={(e) => setEditing({ ...editing, source_key: e.target.value })}
                  disabled={!editing.provider}
                >
                  <option value="">— выбрать —</option>
                  {editing.provider ? sourceKeyList(editing.provider).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  )) : null}
                </select>
              </Field>
            </>
          )}
        </div>

        {/* live preview */}
        <div className="border-t pt-3">
          <div className="text-xs text-[var(--text-mut)] mb-2">Превью на сэмпле (bitcoin/BTC)</div>
          <div className="flex items-center gap-3 text-sm">
            <LinkIcon href={previewUrl ?? "#"} icon={previewIcon ?? null} name={previewName} size={28} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{previewName}</div>
              <div className="truncate text-xs text-[var(--text-mut)]">{previewUrl ?? "—"}</div>
            </div>
          </div>
          {previewBroken && (
            <div className="mt-2 text-xs text-rose-600">
              Битый шаблон: переменная не разрешилась (applyPattern → null).
            </div>
          )}
          {kind === "provider" && !previewUrl && editing.provider && editing.source_key && (
            <div className="mt-2 text-xs text-amber-600">
              Этот источник на сэмпле пуст — добавить можно, но provider-ссылка не появится, пока в снимке монеты не будет данных.
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onSubmit}
            disabled={saving}
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {saving ? "…" : "Сохранить"}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded border text-sm">Отмена</button>
        </div>
      </div>
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