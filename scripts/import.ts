import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// --- 1. Грузим .env.local вручную ---
// Standalone-скрипт через tsx НЕ читает .env.local сам (это делает только Next.js).
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}
loadEnv('.env.local')

// Оверрайды coingecko_id (name -> реальный id CoinGecko) для имён, что не совпадают с id.
const OVERRIDES: Record<string, string | null> = fs.existsSync(
  path.join(process.cwd(), 'coingecko-overrides.json'),
)
  ? JSON.parse(fs.readFileSync(path.join(process.cwd(), 'coingecko-overrides.json'), 'utf-8'))
  : {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !SECRET) {
  console.error('\u274C  Нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SECRET_KEY в .env.local')
  process.exit(1)
}

// Secret-клиент: обходит RLS, сессия не нужна.
const supabase = createClient(URL, SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// --- 2. Маппинг категорий (как было) ---
const categoryMap: Record<string, string> = {
  'Charts': 'chart',
  'Change': 'trade',
  'Aggregators': 'aggregator',
  'Token sale': 'tokenomics',
  'Token unlocks': 'tokenomics',
  'News': 'news',
  'Calendar': 'news',
  'Analytics': 'tools',
  'Usefully': 'tools',
  'Utility': 'tools',
  'Review': 'review',
  'Team': 'team',
  'Social networks': 'social',
}

interface SeedAsset {
  legacyId: number
  name: string
  symbol: string
  sections: Array<{
    title: string
    links: Array<{ title: string; url: string; desc?: string; thumbnailUrl?: string }>
  }>
}
interface SeedData { templates: unknown[]; assets: SeedAsset[] }

function normalizeCategory(title: string): string {
  return categoryMap[title] || title.toLowerCase().replace(/\s+/g, '-')
}

async function importCatalog() {
  const seedPath = path.join(process.cwd(), 'catalog.seed.json')
  if (!fs.existsSync(seedPath)) {
    console.error('\u274C  Не найден catalog.seed.json в корне проекта:', seedPath)
    process.exit(1)
  }
  const data: SeedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'))

  const assets: any[] = []
  const links: any[] = []
  const seenAsset = new Set<string>()

  for (const asset of data.assets) {
    const name = asset.name.trim().replace(/\r\n/g, '')
    if (!name) continue
    const ticker = asset.symbol.toUpperCase()
    // уникальный slug: при коллизии имён добавляем тикер, чтобы не терять активы
    let slug = name
    if (seenAsset.has(slug)) slug = `${name}-${asset.symbol.trim().toLowerCase()}`
    if (seenAsset.has(slug)) continue
    seenAsset.add(slug)
    assets.push({
      id: slug,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      ticker,
      coingecko_id: name in OVERRIDES ? OVERRIDES[name] : name,
      tv_symbol: `BINANCE:${ticker}USDT`,
    })
    for (const section of asset.sections) {
      const category = normalizeCategory(section.title)
      for (const link of section.links) {
        const href = (link.url || '').replace(/!$/, '')
        if (!href) continue
        const broken = href.startsWith('https://#') || href.includes('!')
        let linkName = (link.title || '').trim()
        if (!linkName) {
          try { linkName = new URL(href).hostname.replace(/^www\./, '') } catch { linkName = 'Ссылка' }
        }
        links.push({
          asset_id: slug,
          name: linkName,
          description: link.desc || null,
          href,
          category,
          tier: 'Trusted',
          health: broken ? 'broken' : 'alive',
        })
      }
    }
  }

  console.log(`Подготовлено: ${assets.length} assets, ${links.length} links`)

  // --- 3. Пишем в Supabase ---
  const CHUNK = 500

  // assets: upsert по id (повторный запуск безопасен)
  for (let i = 0; i < assets.length; i += CHUNK) {
    const batch = assets.slice(i, i + CHUNK)
    const { error } = await supabase.from('assets').upsert(batch, { onConflict: 'id' })
    if (error) { console.error('\u274C  assets batch', i, error.message); process.exit(1) }
    console.log(`  assets ${Math.min(i + CHUNK, assets.length)}/${assets.length}`)
  }

  // links: id = автогенерируемый uuid, поэтому чистим и вставляем заново (идемпотентно)
  const { error: delErr } = await supabase
    .from('links')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) { console.error('\u274C  links delete', delErr.message); process.exit(1) }

  for (let i = 0; i < links.length; i += CHUNK) {
    const batch = links.slice(i, i + CHUNK)
    const { error } = await supabase.from('links').insert(batch)
    if (error) { console.error('\u274C  links batch', i, error.message); process.exit(1) }
    console.log(`  links ${Math.min(i + CHUNK, links.length)}/${links.length}`)
  }

  // --- 4. Проверка ---
  const { count: aCount } = await supabase.from('assets').select('*', { count: 'exact', head: true })
  const { count: lCount } = await supabase.from('links').select('*', { count: 'exact', head: true })
  console.log(`\u2705  Готово. В базе: ${aCount} assets, ${lCount} links`)
}

importCatalog().catch((e) => { console.error(e); process.exit(1) })
