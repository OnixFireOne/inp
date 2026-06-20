"use client"
// app/(admin)/admin/link-categories/page.tsx
// CRUD screen for link_categories.
// Uses the default Supabase data provider (no custom provider needed).
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useList, useCreate, useUpdate, useDelete } from "@refinedev/core"

type Category = {
  key: string
  label: string
  icon: string | null
  sort: number
}

export default function LinkCategoriesPage() {
  const router = useRouter()
  const { query } = useList<Category>({
    resource: "link_categories",
    sorters: [{ field: "sort", order: "asc" }],
  })

  const create = useCreate()
  const update = useUpdate()
  const remove = useDelete()

  const [editing, setEditing] = useState<Partial<Category> | null>(null)
  const [saving, setSaving] = useState(false)

  const rows = query.data?.data ?? []
  const err = query.error as { message?: string } | null

  async function submit() {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.key) {
        await update.mutateAsync({ resource: "link_categories", id: editing.key, values: editing })
      } else {
        await create.mutateAsync({ resource: "link_categories", values: editing })
      }
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(key: string) {
    if (!confirm("Удалить категорию?")) return
    await remove.mutateAsync({ resource: "link_categories", id: key })
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
              Управление категориями для группировки ссылок в редакторе и на витрине.
            </p>
          </div>
          <button
            onClick={() => setEditing({ sort: rows.length > 0 ? (rows[rows.length - 1].sort ?? 0) + 10 : 0 })}
            className="px-3 py-1.5 rounded border text-sm"
          >
            + Добавить
          </button>
        </header>

        {err?.message && (
          <div className="text-sm text-rose-600 mb-3">{err.message}</div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left">
              <tr className="text-xs uppercase text-[var(--text-mut)]">
                <th className="px-3 py-2 w-20">Sort</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2 w-16">Icon</th>
                <th className="px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--text-mut)]">загрузка…</td></tr>
              )}
              {!query.isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-[var(--text-mut)]">пусто</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="px-3 py-2 tabular-nums text-[var(--text-mut)]">{r.sort}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.key}</td>
                  <td className="px-3 py-2">{r.label}</td>
                  <td className="px-3 py-2 text-[var(--text-mut)]">{r.icon ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(r)} className="text-[var(--text-mut)] hover:text-[var(--text)] cursor-pointer mr-2" aria-label="Редактировать">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button onClick={() => onDelete(r.key)} className="text-xs text-rose-600 hover:text-rose-500 cursor-pointer">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <Field label="sort (число, порядок)">
                  <input
                    type="number"
                    className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
                    value={editing.sort ?? 0}
                    onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) })}
                  />
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
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded border text-sm">Отмена</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
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
