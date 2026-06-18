"use client"
// components/admin/AssetEditor.tsx
// Two modes:
//   - edit:  resource="assets", id=existing.id  -> useForm fetches the row
//            and patches on submit.
//   - add:   id is the slug from the CoinGecko row; we pass `defaultValues`
//            so the form starts pre-filled.
//
// Refine v5 useForm from @refinedev/react-hook-form gives us:
//   - register / handleSubmit / formState (RHF)
//   - refineCore.onFinish / queryResult / formLoading / redirect
// We don't use `redirect` from useForm — the parent page handles navigation.
import { useEffect } from "react"
import { useForm } from "@refinedev/react-hook-form"
import { useOne, type HttpError } from "@refinedev/core"
import { LinksEditor } from "./LinksEditor"
import type { MarketRow } from "@/lib/types"

type Described = {
  id: string
  coingecko_id: string
  name: string
  ticker: string
  icon: string | null
}

type AssetFormValues = {
  id: string
  name: string
  ticker: string
  coingecko_id: string
  icon: string | null
  tv_symbol: string
}

export function AssetEditor({
  market,
  existing,
  onClose,
}: {
  market: MarketRow
  existing: Described | undefined
  onClose: () => void
}) {
  const isEdit = !!existing
  const targetId = existing?.id ?? market.id

  // tv_symbol is not in the editor's `existing` subset — pull it via useOne
  // only when editing so we don't clobber it.
  const tvQuery = useOne<{ id: string; tv_symbol: string | null }>({
    resource: "assets",
    id: existing?.id ?? "",
    queryOptions: { enabled: !!existing, staleTime: Infinity },
  })

  const {
    register,
    handleSubmit,
    setValue,
    refineCore: { onFinish, formLoading, query },
  } = useForm<AssetFormValues, HttpError, AssetFormValues>({
    // defaultValues goes to RHF, NOT to refineCoreProps.
    defaultValues: isEdit
      ? {
          id: existing!.id,
          name: existing!.name,
          ticker: existing!.ticker,
          coingecko_id: existing!.coingecko_id,
          icon: existing!.icon,
          tv_symbol: "",
        }
      : {
          id: market.id,
          name: market.name,
          ticker: market.symbol.toUpperCase(),
          coingecko_id: market.id,
          icon: market.image,
          tv_symbol: `BINANCE:${market.symbol.toUpperCase()}USDT`,
        },
    refineCoreProps: {
      resource: "assets",
      action: isEdit ? "edit" : "create",
      id: isEdit ? targetId : undefined,
      redirect: false,
    },
  })

  // When editing, push the freshly-fetched tv_symbol into the form once.
  useEffect(() => {
    if (!isEdit) return
    const tv = tvQuery.query.data?.data?.tv_symbol
    if (tv != null) setValue("tv_symbol", String(tv), { shouldDirty: false })
  }, [isEdit, tvQuery.query.data, setValue])

  return (
    <form onSubmit={handleSubmit(onFinish)} className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-medium">
          {isEdit ? "Редактирование актива" : "Описать монету"}
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="id (slug)">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("id", { required: true })}
              disabled={isEdit}
            />
          </Field>
          <Field label="coingecko_id">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("coingecko_id", { required: true })}
            />
          </Field>
          <Field label="name">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("name", { required: true })}
            />
          </Field>
          <Field label="ticker">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("ticker", { required: true })}
            />
          </Field>
          <Field label="icon URL">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("icon")}
            />
          </Field>
          <Field label="tv_symbol">
            <input
              className="w-full border rounded px-2 py-1.5 bg-[var(--surface)]"
              {...register("tv_symbol")}
              placeholder="BINANCE:BTCUSDT"
            />
          </Field>
        </div>
        {query?.error && (
          <div className="text-sm text-rose-600">
            {String((query.error as unknown as Error).message ?? query.error)}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={formLoading}
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {formLoading ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
          </button>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border text-sm">
            Закрыть
          </button>
        </div>
      </section>

      {isEdit && (
        <section className="border-t pt-4">
          <LinksEditor assetId={existing!.id} />
        </section>
      )}
    </form>
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
