import fs from 'fs';
import path from 'path';

// Category mapping per BUILD_BRIEF.md:89
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
};

interface SeedAsset {
  legacyId: number;
  name: string;
  symbol: string;
  sections: Array<{
    title: string;
    links: Array<{
      title: string;
      url: string;
      desc?: string;
      thumbnailUrl?: string;
    }>;
  }>;
}

interface SeedData {
  templates: unknown[];
  assets: SeedAsset[];
}

function normalizeCategory(title: string): string {
  return categoryMap[title] || title.toLowerCase().replace(/\s+/g, '-');
}

async function importCatalog() {
  const seedPath = path.join(process.cwd(), 'catalog.seed.json');
  const data: SeedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  const assets: any[] = [];
  const links: any[] = [];

  for (const asset of data.assets) {
    const name = asset.name.trim().replace(/\r\n/g, '');
    const ticker = asset.symbol.toUpperCase();

    assets.push({
      id: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      ticker,
      coingecko_id: name, // placeholder, Phase 2 refine
      tv_symbol: `BINANCE:${ticker}USDT`,
    });

    for (const section of asset.sections) {
      const category = normalizeCategory(section.title);
      for (const link of section.links) {
        const href = link.url.replace(/!$/, ''); // clean placeholder
        const health = href.startsWith('https://#') || href.includes('!') ? 'broken' : 'alive';

        links.push({
          asset_id: name,
          name: link.title,
          description: link.desc || null,
          href,
          category,
          tier: 'Trusted',
          health,
        });
      }
    }
  }

  console.log(`Imported ${assets.length} assets, ${links.length} links`);
  // TODO: write to Supabase in Phase 2
  fs.writeFileSync('import-result.json', JSON.stringify({ assets, links }, null, 2));
}

importCatalog();
