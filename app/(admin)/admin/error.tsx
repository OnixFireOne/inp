"use client"

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold mb-2">Админка временно недоступна</h1>
        <p className="text-sm text-[var(--text-mut)] mb-4">
          Не удалось проверить авторизацию. Это может быть кратковременный сбой сети.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="px-3 py-1.5 rounded border bg-foreground text-background text-sm cursor-pointer"
        >
          Повторить
        </button>
      </div>
    </main>
  )
}
