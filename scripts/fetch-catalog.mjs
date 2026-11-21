/**
 * Multi-store catalog collection & daily auto-update pipeline (v0.9).
 *
 * Usage:
 *   node scripts/fetch-catalog.mjs --dry-run    # Offline verification with sample records
 *   node scripts/fetch-catalog.mjs --update     # Live daily update (15-publisher PR TIMES RSS + openBD + optional Rakuten Books API)
 *
 * Environment variables (optional):
 *   RAKUTEN_APP_ID  Rakuten Books API applicationId (if set in GitHub Actions Secrets)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterOffersByPolicy, groupStoreOffers, normalizeIssueKey } from './normalizer.mjs';
import {
  PRTIMES_PUBLISHER_FEEDS,
  isTargetReleaseTitle,
  parsePrTimesArticleHtml,
} from './prtimes-ingestor.mjs';
import { validateCatalogStructure, verifyImageUrl } from './validate-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../data/catalog.json');

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

function getJstDateInfo() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const iso = jst.toISOString();
  return {
    dateStr: iso.slice(0, 10),
    timestampJst: `${iso.slice(0, 19)}+09:00`,
  };
}

function buildAmazonSearchUrl(query) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}&i=stripbooks`;
}

function buildStoreFallbackSearchUrl(store, query) {
  const q = encodeURIComponent(query);
  if (store === '7net') return `https://7net.omni7.jp/search/?keyword=${q}`;
  if (store === 'rakuten') return `https://books.rakuten.co.jp/search?sitem=${q}`;
  if (store === 'hmv') return `https://www.hmv.co.jp/search/keyword_${q}/target_ALL/type_sr/`;
  if (store === 'tsutaya') return `https://shop.tsutaya.co.jp/search_result.html?searchKeyword=${q}`;
  return buildAmazonSearchUrl(query);
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

  for (const genreId of ['001013001', '001014']) {
    try {
      const pbUrl = `${RAKUTEN_BOOK_API}?applicationId=${encodeURIComponent(
        appId
      )}&booksGenreId=${genreId}&sort=-releaseDate&hits=20`;
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
            isbn: item.isbn || '',
            publisher: item.publisherName || '',
            author: item.author || '',
            isR18: genreId === '001014',
          });
        }
      }
    } catch {
      // Non-fatal
    }
  }
  return results;
}

/**
 * Fetches public PR TIMES RSS across all 15 major publishers (no login required).
 */
async function fetchPrTimesReleases(sinceDate = '2026-10-15') {
  const discovered = [];
  for (const feed of PRTIMES_PUBLISHER_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
      for (const block of itemBlocks.slice(0, 35)) {
        const body = block[1];
        const title = ((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .trim();
        const link = ((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
        const pubDate = ((body.match(/<dc:date>([\s\S]*?)<\/dc:date>/i) || [])[1] || '').slice(0, 10);
        if (!title || !link) continue;
        if (pubDate && pubDate < sinceDate) continue;
        if (!isTargetReleaseTitle(title)) continue;

        discovered.push({
          publisher: feed.publisher,
          title,
          url: link,
          pubDate,
          issueKey: normalizeIssueKey(title),
        });
      }
    } catch {
      // Non-fatal network error per publisher
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

function makeAutoId(url) {
  const m = String(url || '').match(/(\d+\.\d+)\.html$/);
  const slug = m ? m[1].replace(/\./g, '-') : String(Date.now());
  return `auto-pr-${slug}`;
}

async function runDailyCatalogUpdate() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const { dateStr, timestampJst } = getJstDateInfo();
  const appId = process.env.RAKUTEN_APP_ID;

  let addedPressArticles = 0;
  let addedBonusOffers = 0;
  let addedNewItems = 0;

  // 1) Sweep 15 publishers' public PR TIMES RSS feeds (no login required)
  const prItems = await fetchPrTimesReleases('2026-11-01');
  console.log(
    `[collect:update] Swept ${PRTIMES_PUBLISHER_FEEDS.length} publishers -> ${prItems.length} relevant PR TIMES hit(s)`
  );

  const existingUrls = new Set();
  const existingKeys = new Set();
  const existingImages = new Set();
  for (const item of catalog.items || []) {
    existingKeys.add(normalizeIssueKey(item.title));
    if (item.coverImageUrl) existingImages.add(item.coverImageUrl);
    for (const a of item.pressArticles || []) existingUrls.add(a.url);
  }

  for (const pr of prItems) {
    if (existingUrls.has(pr.url)) continue;

    // Attach to existing tracked item if issueKey matches
    const matchedItem = (catalog.items || []).find(
      (it) => normalizeIssueKey(it.title) === pr.issueKey && pr.issueKey.length >= 4
    );
    if (matchedItem) {
      matchedItem.pressArticles = matchedItem.pressArticles || [];
      matchedItem.pressArticles.unshift({
        title: pr.title,
        source: `PR TIMES（${pr.publisher}）`,
        url: pr.url,
        photoCountHint: '自動検出プレスリリース',
      });
      existingUrls.add(pr.url);
      addedPressArticles += 1;
      continue;
    }

    // Auto-discover brand-new photobook / calendar / magazine releases (cap 8 per run to keep diff clean)
    if (addedNewItems >= 8) continue;
    if (!/(写真集|カレンダー|グラビア|表紙)/.test(pr.title)) continue;

    try {
      const artRes = await fetch(pr.url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!artRes.ok) continue;
      const html = await artRes.text();
      const parsed = parsePrTimesArticleHtml(html, pr);
      if (!parsed.releaseDate || !parsed.title) continue;

      const newKey = normalizeIssueKey(parsed.title);
      if (existingKeys.has(newKey)) continue;

      let verifiedCover = '';
      if (parsed.coverImageUrl && !existingImages.has(parsed.coverImageUrl)) {
        const check = await verifyImageUrl(parsed.coverImageUrl);
        if (check.ok) {
          verifiedCover = parsed.coverImageUrl;
          existingImages.add(verifiedCover);
        }
      }

      const itemId = makeAutoId(pr.url);
      if ((catalog.items || []).some((i) => i.id === itemId)) continue;

      const offers = [];
      for (const sb of parsed.storeBonuses) {
        offers.push({
          id: `${itemId}-${sb.store}`,
          store: sb.store,
          hasStoreExclusiveBonus: true,
          edition: `${sb.storeName}限定特典`,
          bonusTypes: sb.bonusTypes,
          bonusText: sb.snippet,
          talent: parsed.title,
          price: parsed.price,
          status: parsed.releaseDate > dateStr ? 'preorder' : 'available',
          artworkStatus: 'pending',
          url: sb.url || buildStoreFallbackSearchUrl(sb.store, parsed.title),
        });
      }
      offers.push({
        id: `${itemId}-amazon`,
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: 'Amazon 通常版',
        bonusTypes: ['standard'],
        bonusText: parsed.isbn
          ? `Amazonで確認（ISBN ${parsed.isbn}）`
          : `Amazonで「${parsed.title}」を確認`,
        talent: parsed.title,
        price: parsed.price,
        status: parsed.releaseDate > dateStr ? 'preorder' : 'available',
        artworkStatus: verifiedCover ? 'revealed' : 'pending',
        ...(verifiedCover ? { imageUrl: verifiedCover } : {}),
        url: buildAmazonSearchUrl(parsed.isbn || parsed.title),
      });

      const newItem = {
        id: itemId,
        title: parsed.title,
        series: parsed.publisher,
        issueLabel: '自動発見新刊',
        publisher: parsed.publisher,
        category: parsed.category,
        releaseDate: parsed.releaseDate,
        price: parsed.price,
        coverTalents: [parsed.title.split(/[『「\s]/)[0] || parsed.title],
        featuredTalents: [parsed.title.split(/[『「\s]/)[0] || parsed.title],
        palette:
          parsed.category === 'r18'
            ? ['#881337', '#BE123C', '#FFE4E6']
            : ['#E11D48', '#FB7185', '#FFE4E6'],
        ...(verifiedCover ? { coverImageUrl: verifiedCover } : {}),
        autoDiscovered: true,
        discoveredAt: dateStr,
        includedBonuses: [],
        printOnlyNote: `${parsed.publisher}公式PR TIMESより自動発見。基本購入先はAmazon、限定特典ありストアのみ表示。`,
        summary: parsed.headline,
        gallery: verifiedCover
          ? [
              {
                url: verifiedCover,
                caption: `${parsed.title} 公式発表カット`,
                source: `PR TIMES（${parsed.publisher}）`,
                kind: 'cover',
                articleUrl: pr.url,
              },
            ]
          : [],
        pressArticles: [
          {
            title: parsed.headline,
            source: `PR TIMES（${parsed.publisher}）`,
            url: pr.url,
            photoCountHint: '公式自動発見プレスリリース',
          },
        ],
        offers: filterOffersByPolicy(offers),
      };

      catalog.items.unshift(newItem);
      existingKeys.add(newKey);
      existingUrls.add(pr.url);
      addedNewItems += 1;
    } catch {
      // Skip transient article errors
    }
  }

  // 2) If RAKUTEN_APP_ID is configured, check Rakuten Books for new exclusive-bonus editions & brand-new photobooks/R18
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
      if (target) {
        for (const offer of g.offers) {
          if (offer.store === 'amazon') continue;
          if (!offer.hasStoreExclusiveBonus) continue;
          const alreadyExists = (target.offers || []).some(
            (o) => o.store === offer.store && o.url === offer.url
          );
          if (alreadyExists) continue;

          let verifiedImage;
          if (offer.imageUrl && !existingImages.has(offer.imageUrl)) {
            const check = await verifyImageUrl(offer.imageUrl);
            if (check.ok) {
              verifiedImage = offer.imageUrl;
              existingImages.add(verifiedImage);
            }
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
        continue;
      }

      // Brand-new photobook / R18 auto-discovery from Rakuten Books (strictly policy-compliant!)
      if (addedNewItems >= 16) continue;
      const sampleRaw = rawRecords.find((r) => normalizeIssueKey(r.title) === g.groupKey);
      if (!sampleRaw || !sampleRaw.isbn || !isTargetReleaseTitle(sampleRaw.title)) continue;
      const dateMatch = String(sampleRaw.releaseDate || '').match(/(202[567])年(\d{1,2})月(\d{1,2})日/);
      if (!dateMatch) continue;
      const relDate = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
      const newId = `auto-rb-${sampleRaw.isbn}`;
      if ((catalog.items || []).some((i) => i.id === newId)) continue;

      let verifiedCover = '';
      if (sampleRaw.imageUrl && !existingImages.has(sampleRaw.imageUrl)) {
        const check = await verifyImageUrl(sampleRaw.imageUrl);
        if (check.ok) {
          verifiedCover = sampleRaw.imageUrl;
          existingImages.add(verifiedCover);
        }
      }

      const category = sampleRaw.isR18
        ? 'r18'
        : /カレンダー/.test(sampleRaw.title)
          ? 'calendar'
          : 'photobook';
      const talent = String(sampleRaw.author || sampleRaw.title.split(/\s+/)[0] || '注目タレント').trim();
      const offers = [];
      for (const bonusOffer of g.offers) {
        if (bonusOffer.store === 'rakuten' && bonusOffer.hasStoreExclusiveBonus) {
          offers.push({
            id: `${newId}-rakuten`,
            store: 'rakuten',
            hasStoreExclusiveBonus: true,
            edition: '楽天ブックス限定特典',
            bonusTypes: bonusOffer.bonusTypes,
            bonusText: bonusOffer.bonusText,
            talent,
            price: bonusOffer.price || sampleRaw.price || 3300,
            status: relDate > dateStr ? 'preorder' : 'available',
            artworkStatus: 'pending',
            url: bonusOffer.url,
          });
        }
      }
      offers.push({
        id: `${newId}-amazon`,
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: 'Amazon 通常版',
        bonusTypes: ['standard'],
        bonusText: `Amazonで確認（ISBN ${sampleRaw.isbn}）`,
        talent,
        price: sampleRaw.price || 3300,
        status: relDate > dateStr ? 'preorder' : 'available',
        artworkStatus: verifiedCover ? 'revealed' : 'pending',
        ...(verifiedCover ? { imageUrl: verifiedCover } : {}),
        url: buildAmazonSearchUrl(sampleRaw.isbn),
      });

      const createdItem = {
        id: newId,
        title: sampleRaw.title.replace(/【楽天ブックス限定特典】/g, '').trim(),
        series: sampleRaw.publisher || '楽天ブックス新刊',
        issueLabel: '自動発見新刊',
        publisher: sampleRaw.publisher || '出版社公式',
        category,
        releaseDate: relDate,
        price: sampleRaw.price || 3300,
        coverTalents: [talent],
        featuredTalents: [talent],
        palette:
          category === 'r18'
            ? ['#881337', '#BE123C', '#FFE4E6']
            : ['#E11D48', '#FB7185', '#FFE4E6'],
        ...(verifiedCover ? { coverImageUrl: verifiedCover } : {}),
        autoDiscovered: true,
        discoveredAt: dateStr,
        includedBonuses: [],
        printOnlyNote: '楽天ブックス新刊APIより自動発見。基本購入先はAmazon、限定特典ありストアのみ表示。',
        summary: sampleRaw.description ? sampleRaw.description.slice(0, 140) : sampleRaw.title,
        gallery: verifiedCover
          ? [
              {
                url: verifiedCover,
                caption: `${sampleRaw.title} 公式書影`,
                source: '楽天ブックス',
                kind: 'cover',
                articleUrl: buildAmazonSearchUrl(sampleRaw.isbn),
              },
            ]
          : [],
        pressArticles: [],
        offers: filterOffersByPolicy(offers),
      };

      catalog.items.unshift(createdItem);
      itemByKey.set(g.groupKey, createdItem);
      addedNewItems += 1;
    }
  } else {
    console.log(
      '[collect:update] RAKUTEN_APP_ID not set — ran 15-publisher public PR TIMES auto-discovery.'
    );
  }

  // Enforce noise-free store policy across every item before saving
  for (const item of catalog.items || []) {
    item.offers = filterOffersByPolicy(item.offers || []);
  }

  catalog.referenceDate = dateStr;
  catalog.lastAutoCheckedAt = timestampJst;
  if (addedPressArticles > 0 || addedBonusOffers > 0 || addedNewItems > 0) {
    catalog.updatedAt = timestampJst;
  }

  const report = validateCatalogStructure(catalog);
  if (report.errors.length > 0) {
    console.error('[collect:update] Validation failed; aborting write:', report.errors);
    process.exit(1);
  }

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(
    `[collect:update] Done! referenceDate=${dateStr}, +${addedNewItems} new items, +${addedPressArticles} press, +${addedBonusOffers} bonus offers, nonAmazonNonBonus=${report.nonAmazonNonBonus}`
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
