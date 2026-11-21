/**
 * Multi-store catalog collection prototype pipeline.
 *
 * Usage:
 *   node scripts/fetch-catalog.mjs --dry-run
 *
 * Production mode (e.g. GitHub Actions daily cron):
 *   RAKUTEN_APP_ID=xxxx node scripts/fetch-catalog.mjs
 */
import { filterOffersByPolicy, groupStoreOffers } from './normalizer.mjs';

const RAKUTEN_MAGAZINE_API =
  'https://app.rakuten.co.jp/services/api/BooksMagazine/Search/20170404';
const RAKUTEN_BOOK_API =
  'https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404';

const TARGET_KEYWORDS = [
  'B.L.T.',
  'BOMB',
  'アップトゥボーイ',
  'BUBKA',
  'EX大衆',
  '週刊プレイボーイ',
  'FLASH',
  'FRIDAY',
  '週刊少年チャンピオン',
  'ビッグコミックスピリッツ',
  'グラビアザテレビジョン',
];

async function fetchRakutenBonuses(appId) {
  const results = [];
  for (const kw of TARGET_KEYWORDS) {
    const url = `${RAKUTEN_MAGAZINE_API}?applicationId=${encodeURIComponent(
      appId
    )}&title=${encodeURIComponent(kw)}&sort=-releaseDate&hits=5`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = await res.json();
    for (const entry of json.Items || []) {
      const item = entry.Item;
      results.push({
        store: 'rakuten',
        title: item.title,
        description: item.itemCaption || '',
        releaseDate: item.salesDate || '',
        price: item.itemPrice || 0,
        url: item.itemUrl,
      });
    }
  }

  // Photobooks genre (001013 = 写真集・タレント)
  const pbUrl = `${RAKUTEN_BOOK_API}?applicationId=${encodeURIComponent(
    appId
  )}&booksGenreId=001013&sort=-releaseDate&hits=20`;
  const pbRes = await fetch(pbUrl);
  if (pbRes.ok) {
    const pbJson = await pbRes.json();
    for (const entry of pbJson.Items || []) {
      const item = entry.Item;
      results.push({
        store: 'rakuten',
        title: item.title,
        description: item.itemCaption || '',
        releaseDate: item.salesDate || '',
        price: item.itemPrice || 0,
        url: item.itemUrl,
      });
    }
  }
  return results;
}

function getDryRunSamples() {
  return [
    {
      store: '7net',
      title:
        'アップトゥボーイ 2027年1月号【セブンネット限定特典：川﨑桜（乃木坂46）ポストカードA 1枚付き】',
      description: '特大両面ポスター付録',
      releaseDate: '2026-11-24',
      price: 1400,
      url: 'https://7net.omni7.jp/search?q=UTB',
    },
    {
      store: 'tsutaya',
      title: 'アップトゥボーイ 2027年1月号増刊 TSUTAYA限定表紙版',
      description: '古畑奈和表紙',
      releaseDate: '2026-11-24',
      price: 1400,
      url: 'https://tsutaya.tsite.jp/articles/book-comic-5993',
    },
    {
      store: '7net',
      title: 'ビッグコミックスピリッツ 2026年12月7日号【セブンネット限定特典：井口裕香 生写真付き】',
      description: '週刊コミック誌限定生写真',
      releaseDate: '2026-11-24',
      price: 500,
      url: 'https://7net.omni7.jp/search?q=スピリッツ',
    },
    {
      store: 'rakuten',
      title: '【楽天ブックス限定特典】グラビアザテレビジョン vol.82(山田あい大判ブロマイド)',
      description: '大判ブロマイド',
      releaseDate: '2026-11-26',
      price: 1760,
      url: 'https://books.rakuten.co.jp/',
    },
    {
      store: 'rakuten',
      title: 'アップトゥボーイ 2027年1月号 [雑誌]',
      description: '特典なし通常版（ノイズとして除外される対象）',
      releaseDate: '2026-11-24',
      price: 1400,
      url: 'https://books.rakuten.co.jp/normal',
    },
    {
      store: 'amazon',
      title: 'アップトゥボーイ 2027年1月号',
      description: 'Amazon基本購入先',
      releaseDate: '2026-11-24',
      price: 1400,
      url: 'https://www.amazon.co.jp/',
    },
  ];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const appId = process.env.RAKUTEN_APP_ID;

  let records = [];
  if (dryRun || !appId) {
    console.log('[collect] Running in dry-run verification mode (no external API key required).');
    records = getDryRunSamples();
  } else {
    console.log('[collect] Fetching live records from Rakuten Books API...');
    records = await fetchRakutenBonuses(appId);
  }

  const grouped = groupStoreOffers(records).map((g) => ({
    ...g,
    offers: filterOffersByPolicy(g.offers),
  }));
  console.log(`[collect] Input listings: ${records.length} -> Grouped titles: ${grouped.length}`);
  for (const g of grouped) {
    console.log(
      `  - ${g.groupKey} (${g.offers.length} kept offers): ${g.offers
        .map((o) => `${o.store}[${o.bonusTypes.join(',')}]`)
        .join(', ')}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
