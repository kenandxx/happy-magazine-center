/**
 * Multi-store catalog collection & daily auto-update pipeline (v1.0).
 *
 * Usage:
 *   node scripts/fetch-catalog.mjs --dry-run    # Offline verification with sample records
 *   node scripts/fetch-catalog.mjs --update     # Live daily update (15-publisher PR TIMES RSS + openBD + optional Rakuten Books API)
 *
 * Environment variables (optional):
 *   RAKUTEN_APP_ID  Rakuten Books API applicationId (set in GitHub Actions Secrets to unlock 100% Rakuten Books photobook/R18/bonus ingestion)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isbn13To10 } from '../src/isbn-lookup.js';
import { filterOffersByPolicy, groupStoreOffers, normalizeIssueKey } from './normalizer.mjs';
import {
  PRTIMES_PUBLISHER_FEEDS,
  isTargetReleaseTitle,
  parsePrTimesArticleHtml,
} from './prtimes-ingestor.mjs';
import {
  buildCatalogItemFromRakuten,
  fetchRakutenCatalogRecords,
  isRelevantRakutenRecord,
} from './rakuten-ingestor.mjs';
import { validateCatalogStructure, verifyImageUrl } from './validate-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../data/catalog.json');

function getJstDateInfo() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const iso = jst.toISOString();
  return {
    dateStr: iso.slice(0, 10),
    timestampJst: `${iso.slice(0, 19)}+09:00`,
  };
}

function buildAmazonUrlForBook(isbnOrTitle, fallbackTitle = '') {
  const isbn10 = isbn13To10(isbnOrTitle);
  if (isbn10) {
    return `https://www.amazon.co.jp/dp/${isbn10}`;
  }
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(fallbackTitle || isbnOrTitle)}&i=stripbooks`;
}

function buildStoreFallbackSearchUrl(store, query) {
  const q = encodeURIComponent(query);
  if (store === '7net') return `https://7net.omni7.jp/search/?keyword=${q}`;
  if (store === 'rakuten') return `https://books.rakuten.co.jp/search?sitem=${q}`;
  if (store === 'hmv') return `https://www.hmv.co.jp/search/keyword_${q}/target_ALL/type_sr/`;
  if (store === 'tsutaya') return `https://shop.tsutaya.co.jp/search_result.html?searchKeyword=${q}`;
  return buildAmazonUrlForBook(query);
}

/**
 * Fetches public PR TIMES RSS across all 15 major publishers (no login required).
 */
async function fetchPrTimesReleases(sinceDate = '2026-11-01') {
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

function writeGitHubStepSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    fs.appendFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Non-fatal
  }
}

async function runDailyCatalogUpdate() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const { dateStr, timestampJst } = getJstDateInfo();
  const appId = String(process.env.RAKUTEN_APP_ID || '').trim();
  const accessKey = String(process.env.RAKUTEN_ACCESS_KEY || '').trim();
  const allowedOrigin = String(process.env.RAKUTEN_ALLOWED_ORIGIN || 'https://kenandxx.github.io').trim();

  let addedPressArticles = 0;
  let addedBonusOffers = 0;
  let addedPrItems = 0;
  let addedRakutenItems = 0;

  // 1) Sweep 15 publishers' public PR TIMES RSS feeds (no login required)
  const prItems = await fetchPrTimesReleases('2026-11-01');
  console.log(
    `[collect:update] Swept ${PRTIMES_PUBLISHER_FEEDS.length} publishers -> ${prItems.length} relevant PR TIMES hit(s)`
  );

  const existingUrls = new Set();
  const existingKeys = new Set();
  const existingIsbns = new Set();
  const existingImages = new Set();
  for (const item of catalog.items || []) {
    existingKeys.add(normalizeIssueKey(item.title));
    if (item.isbn) existingIsbns.add(String(item.isbn).replace(/[^0-9]/g, ''));
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

    // Auto-discover brand-new photobook / calendar / magazine releases (cap 8 per run)
    if (addedPrItems >= 8) continue;
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
      if (parsed.isbn && existingIsbns.has(parsed.isbn)) continue;

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

      const amazonUrl = buildAmazonUrlForBook(parsed.isbn || parsed.title, parsed.title);
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
        url: amazonUrl,
      });

      const newItem = {
        id: itemId,
        ...(parsed.isbn ? { isbn: parsed.isbn } : {}),
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
      if (parsed.isbn) existingIsbns.add(parsed.isbn);
      existingUrls.add(pr.url);
      addedPrItems += 1;
    } catch {
      // Skip transient article errors
    }
  }

  // 2) If RAKUTEN_APP_ID is configured, sweep Rakuten Books API (2026 OpenAPI: 16 magazines + Photobooks + R18 + Calendars + Exclusive Bonuses)
  const rakutenReady = Boolean(appId && accessKey);
  if (appId) {
    console.log(
      `[collect:update] Fetching live Rakuten Books API records (mode=${accessKey ? 'openapi-2026' : 'legacy'}, origin=${allowedOrigin})...`
    );
    const rawRecords = await fetchRakutenCatalogRecords({ appId, accessKey, allowedOrigin });
    console.log(`[collect:update] Rakuten Books API returned ${rawRecords.length} unique record(s)`);

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

      // Brand-new photobook / R18 / calendar auto-discovery from Rakuten Books (strictly policy-compliant)
      if (addedRakutenItems >= 15) continue;
      const sampleRaw = rawRecords.find((r) => normalizeIssueKey(r.title) === g.groupKey);
      if (!sampleRaw || !isRelevantRakutenRecord(sampleRaw)) continue;
      const cleanIsbn = String(sampleRaw.isbn || '').replace(/[^0-9]/g, '');
      if (cleanIsbn && existingIsbns.has(cleanIsbn)) continue;

      let verifiedCover = '';
      if (sampleRaw.imageUrl && !existingImages.has(sampleRaw.imageUrl)) {
        const check = await verifyImageUrl(sampleRaw.imageUrl);
        if (check.ok) {
          verifiedCover = sampleRaw.imageUrl;
          existingImages.add(verifiedCover);
        }
      }

      const createdItem = buildCatalogItemFromRakuten({
        raw: sampleRaw,
        bonusOffers: g.offers,
        verifiedCover,
        dateStr,
      });
      if (!createdItem) continue;
      if ((catalog.items || []).some((i) => i.id === createdItem.id)) continue;

      catalog.items.unshift(createdItem);
      itemByKey.set(g.groupKey, createdItem);
      if (cleanIsbn) existingIsbns.add(cleanIsbn);
      addedRakutenItems += 1;
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

  const totalNewItems = addedPrItems + addedRakutenItems;
  catalog.referenceDate = dateStr;
  catalog.lastAutoCheckedAt = timestampJst;
  catalog.autoSources = {
    prtimesPublishers: PRTIMES_PUBLISHER_FEEDS.length,
    rakutenApiConnected: Boolean(appId),
    rakutenOpenApi2026: rakutenReady,
    lastRunAt: timestampJst,
    lastRunSummary: appId
      ? `15出版社PR TIMES (+${addedPrItems}) ＋ 楽天ブックスAPI (+${addedRakutenItems}作品 / +${addedBonusOffers}特典)`
      : `15出版社PR TIMES自動巡回 (+${addedPrItems}作品 / +${addedPressArticles}記事) ※楽天API未設定`,
  };
  if (addedPressArticles > 0 || addedBonusOffers > 0 || totalNewItems > 0) {
    catalog.updatedAt = timestampJst;
  }

  const report = validateCatalogStructure(catalog);
  if (report.errors.length > 0) {
    console.error('[collect:update] Validation failed; aborting write:', report.errors);
    process.exit(1);
  }

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(
    `[collect:update] Done! referenceDate=${dateStr}, +${totalNewItems} new items (PR:${addedPrItems}, Rakuten:${addedRakutenItems}), +${addedPressArticles} press, +${addedBonusOffers} bonus offers, nonAmazonNonBonus=${report.nonAmazonNonBonus}`
  );

  writeGitHubStepSummary([
    '## 🤖 Happy Magazine Center Daily Auto-Update Summary',
    `- **基準日 (JST)**: \`${dateStr}\``,
    `- **PR TIMES 15出版社自動巡回**: +${addedPrItems} 新刊 / +${addedPressArticles} プレスリリース`,
    `- **楽天ブックスAPI (2026 OpenAPI)**: ${
      rakutenReady
        ? `✅ 連携稼働中 (+${addedRakutenItems} 新刊 / +${addedBonusOffers} 限定特典)`
        : appId
          ? '⚠️ RAKUTEN_APP_ID のみ設定済（2026年版は RAKUTEN_ACCESS_KEY も必要です）'
          : '🔑 未設定（GitHub Secrets に RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を登録すると有効化）'
    }`,
    `- **カタログ総数**: **${report.totalItems} 作品** / **${report.totalOffers} オファー**（非Amazon無特典: **${report.nonAmazonNonBonus} 件**）`,
  ]);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const updateMode = process.argv.includes('--update');

  if (updateMode && !dryRun) {
    await runDailyCatalogUpdate();
    return;
  }

  const appId = String(process.env.RAKUTEN_APP_ID || '').trim();
  const accessKey = String(process.env.RAKUTEN_ACCESS_KEY || '').trim();
  const allowedOrigin = String(process.env.RAKUTEN_ALLOWED_ORIGIN || 'https://kenandxx.github.io').trim();
  let records = [];
  if (dryRun || !appId) {
    console.log('[collect] Running in dry-run verification mode (no external API key required).');
    records = getDryRunSamples();
  } else {
    console.log('[collect] Fetching live records from Rakuten Books API (2026 OpenAPI)...');
    records = await fetchRakutenCatalogRecords({ appId, accessKey, allowedOrigin });
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
