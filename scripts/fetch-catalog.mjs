/**
 * Multi-store catalog collection & daily auto-update pipeline.
 *
 * Usage:
 *   node scripts/fetch-catalog.mjs --dry-run    # Offline verification with sample records
 *   node scripts/fetch-catalog.mjs --update     # Live daily update (PR TIMES public RSS + optional Rakuten Books API)
 *
 * Environment variables (optional):
 *   RAKUTEN_APP_ID  Rakuten Books API applicationId (if set in GitHub Actions Secrets)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterOffersByPolicy, groupStoreOffers, normalizeIssueKey } from './normalizer.mjs';
import { validateCatalogStructure, verifyImageUrl } from './validate-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../data/catalog.json');

const RAKUTEN_MAGAZINE_API =
  'https://app.rakuten.co.jp/services/api/BooksMagazine/Search/20170404';
const RAKUTEN_BOOK_API =
  'https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404';

// Public no-login PR TIMES RSS feeds for idol/gravure magazine publishers
const PRTIMES_RSS_FEEDS = [
  {
    publisher: '東京ニュース通信社',
    url: 'https://prtimes.jp/companyrdf.php?company_id=6568',
  },
];

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

function getJstDateInfo() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const iso = jst.toISOString();
  return {
    dateStr: iso.slice(0, 10),
    timestampJst: `${iso.slice(0, 19)}+09:00`,
  };
}

async function fetchRakutenBonuses(appId) {
  const results = [];
  for (const kw of TARGET_KEYWORDS) {
    try {
      const url = `${RAKUTEN_MAGAZINE_API}?applicationId=${encodeURIComponent(
        appId
      )}&title=${encodeURIComponent(kw)}&sort=-releaseDate&hits=5`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
          imageUrl: item.largeImageUrl || '',
        });
      }
    } catch {
      // Ignore transient network errors per keyword
    }
  }

  try {
    const pbUrl = `${RAKUTEN_BOOK_API}?applicationId=${encodeURIComponent(
      appId
    )}&booksGenreId=001013&sort=-releaseDate&hits=20`;
    const pbRes = await fetch(pbUrl, { signal: AbortSignal.timeout(10000) });
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
          imageUrl: item.largeImageUrl || '',
        });
      }
    }
  } catch {
    // Non-fatal
  }
  return results;
}

/**
 * Fetches public PR TIMES RSS (no login required) to discover newly published
 * cover/bonus press announcements for tracked magazine series.
 */
async function fetchPrTimesReleases() {
  const discovered = [];
  for (const feed of PRTIMES_RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
      for (const block of itemBlocks.slice(0, 25)) {
        const body = block[1];
        const title = ((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .trim();
        const link = ((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
        if (!title || !link) continue;
        if (/B\.L\.T\.|blt\s*graph|BLT\s*MONSTER|BLTISM|写真集|カレンダー/i.test(title)) {
          discovered.push({
            publisher: feed.publisher,
            title,
            url: link,
            issueKey: normalizeIssueKey(title),
          });
        }
      }
    } catch {
      // Non-fatal network error
    }
  }
  return discovered;
}

function getDryRunSamples() {
  return [
    {
      store: '7net',
      title:
        'アップトゥボーイ 2027年1月号【セブンネット限定特典：川﨑桜（乃木坂46）ポストカードA 1枚付き】',
      description: '特大両面ポスター付録',
      releaseDate: '2026-11-24',
      price: 1540,
      url: 'https://7net.omni7.jp/search?q=UTB',
    },
    {
      store: 'tsutaya',
      title: 'アップトゥボーイ 2027年1月号増刊 TSUTAYA限定表紙版',
      description: '古畑奈和表紙',
      releaseDate: '2026-11-24',
      price: 1540,
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
      price: 1540,
      url: 'https://books.rakuten.co.jp/normal',
    },
    {
      store: 'amazon',
      title: 'アップトゥボーイ 2027年1月号',
      description: 'Amazon基本購入先',
      releaseDate: '2026-11-24',
      price: 1540,
      url: 'https://www.amazon.co.jp/',
    },
  ];
}

async function runDailyCatalogUpdate() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const { dateStr, timestampJst } = getJstDateInfo();
  const appId = process.env.RAKUTEN_APP_ID;

  let addedPressArticles = 0;
  let addedBonusOffers = 0;

  // 1) Check public PR TIMES RSS for newly published press announcements matching tracked items
  const prItems = await fetchPrTimesReleases();
  console.log(`[collect:update] PR TIMES scanned: ${prItems.length} relevant release(s)`);

  for (const item of catalog.items || []) {
    const itemKey = normalizeIssueKey(item.title);
    for (const pr of prItems) {
      if (pr.issueKey === itemKey && itemKey.includes('::')) {
        item.pressArticles = item.pressArticles || [];
        if (!item.pressArticles.some((a) => a.url === pr.url)) {
          item.pressArticles.unshift({
            title: pr.title,
            source: `PR TIMES（${pr.publisher}）`,
            url: pr.url,
            photoCountHint: '自動検出プレスリリース',
          });
          addedPressArticles += 1;
        }
      }
    }
  }

  // 2) If RAKUTEN_APP_ID is configured, check Rakuten Books for new exclusive-bonus editions
  if (appId) {
    console.log('[collect:update] Fetching live Rakuten Books records...');
    const rawRecords = await fetchRakutenBonuses(appId);
    const grouped = groupStoreOffers(rawRecords).map((g) => ({
      ...g,
      offers: filterOffersByPolicy(g.offers),
    }));

    const itemByKey = new Map(
      (catalog.items || []).map((it) => [normalizeIssueKey(it.title), it])
    );

    for (const g of grouped) {
      const target = itemByKey.get(g.groupKey);
      if (!target) continue;
      for (const offer of g.offers) {
        if (offer.store === 'amazon') continue;
        if (!offer.hasStoreExclusiveBonus) continue;
        const alreadyExists = (target.offers || []).some(
          (o) => o.store === offer.store && o.url === offer.url
        );
        if (alreadyExists) continue;

        let verifiedImage;
        if (offer.imageUrl) {
          const check = await verifyImageUrl(offer.imageUrl);
          if (check.ok) verifiedImage = offer.imageUrl;
        }
        target.offers.unshift({
          id: `${target.id}-${offer.store}-auto-${Date.now()}`,
          store: offer.store,
          hasStoreExclusiveBonus: true,
          edition: `${offer.store === 'rakuten' ? '楽天ブックス' : offer.store}限定特典`,
          bonusTypes: offer.bonusTypes,
          bonusText: offer.bonusText,
          talent: (target.coverTalents || [])[0] || '',
          price: offer.price || target.price,
          status: 'preorder',
          artworkStatus: verifiedImage ? 'revealed' : 'pending',
          url: offer.url,
          ...(verifiedImage ? { imageUrl: verifiedImage } : {}),
        });
        addedBonusOffers += 1;
      }
    }
  } else {
    console.log('[collect:update] RAKUTEN_APP_ID not set — ran public no-login PR TIMES check only.');
  }

  // Enforce noise-free store policy across every item before saving
  for (const item of catalog.items || []) {
    item.offers = filterOffersByPolicy(item.offers || []);
  }

  catalog.referenceDate = dateStr;
  catalog.lastAutoCheckedAt = timestampJst;
  if (addedPressArticles > 0 || addedBonusOffers > 0) {
    catalog.updatedAt = timestampJst;
  }

  const report = validateCatalogStructure(catalog);
  if (report.errors.length > 0) {
    console.error('[collect:update] Validation failed; aborting write:', report.errors);
    process.exit(1);
  }

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(
    `[collect:update] Done! referenceDate=${dateStr}, +${addedPressArticles} press, +${addedBonusOffers} bonus offers, nonAmazonNonBonus=${report.nonAmazonNonBonus}`
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const updateMode = process.argv.includes('--update');

  if (updateMode && !dryRun) {
    await runDailyCatalogUpdate();
    return;
  }

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
