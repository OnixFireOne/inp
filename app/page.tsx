import { AssetTable } from '@/components/AssetTable';

export default function Home() {
  // Static ISR catalog from seed (Phase 1)
  return (
    <main className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">inp.one</h1>
          <div className="flex items-center gap-4">
            <input
              type="text"
              placeholder="Search assets..."
              className="px-4 py-2 rounded-full bg-[var(--surface)] border border-[var(--border)] text-sm w-80"
            />
            <button className="px-3 py-1 text-sm rounded border border-[var(--border)]">Theme</button>
          </div>
        </header>
        <AssetTable />
      </div>
    </main>
  );
}
