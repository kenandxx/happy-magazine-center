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
import {
  HANMOTO_PUBLISHER_FEEDS,
  buildCatalogItemFromHanmoto,
  fetchBltWebRssArticles,
  fetchHanmotoPhotobookCandidates,
  fetchHmvBooksRssCandidates,
  fetchSevenNetExclusiveCandidates,
} from './multisite-ingestor.mjs';
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
import { refreshMasterpiecesLiveStatus } from './masterpieces-checker.mjs';
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
  let addedHanmotoItems = 0;
  let addedSevenNetItems = 0;
  let addedSevenNetOffers = 0;
  let addedRakutenItems = 0;

  // 1) Sweep 15 publishers' public PR TIMES RSS feeds (no login required)
  const prItems = await fetchPrTimesReleases('2026-11-01');
  console.log(
    `[collect:update] Swept ${PRTIMES_PUBLISHER_FEEDS.length} publishers -> ${prItems.length} relevant PR TIMES hit(s)`
  );

  const existingUrls = new Set();
  const existingOfferUrls = new Set();
  const existingKeys = new Set();
  const existingIsbns = new Set();
  const existingImages = new Set();
  const existingTalentCategory = new Set();
  const existingPhotobookTalents = new Map();

  const normalizeTalentToken = (t) =>
    String(t || '')
      .replace(/（.*?）|\(.*?\)/g, '')
      .replace(/\s+/g, '')
      .trim();

  const registerItemForDedup = (item) => {
    existingKeys.add(normalizeIssueKey(item.title));
    if (item.isbn) existingIsbns.add(String(item.isbn).replace(/[^0-9]/g, ''));
    const rawStr = JSON.stringify(item);
    for (const m of rawStr.matchAll(/9784\d{9}/g)) {
      existingIsbns.add(m[0]);
    }
    if (item.coverImageUrl) existingImages.add(item.coverImageUrl);
    for (const a of item.pressArticles || []) {
      if (a.url) existingUrls.add(a.url);
    }
    for (const o of item.offers || []) {
      if (o.url) existingOfferUrls.add(o.url);
      if (o.imageUrl) existingImages.add(o.imageUrl);
    }
    for (const t of item.coverTalents || []) {
      const cleanT = normalizeTalentToken(t);
      if (cleanT.length >= 2 && (item.category === 'photobook' || item.category === 'r18' || item.category === 'calendar')) {
        existingTalentCategory.add(`${cleanT}::${item.releaseDate?.slice(0, 7) || ''}`);
        if (!existingPhotobookTalents.has(cleanT)) {
          existingPhotobookTalents.set(cleanT, item);
        }
      }
    }
  };

  const findExistingItemByTalentOrMagazine = (text, releaseDate = '', category = '') => {
    const cleanText = String(text || '').replace(/\s+/g, '');
    // 1. Direct photobook/calendar/r18 talent match
    if (!category || category === 'photobook' || category === 'r18' || category === 'calendar') {
      for (const [talent, item] of existingPhotobookTalents.entries()) {
        if (talent.length >= 2 && cleanText.includes(talent)) {
          const sameKind =
            (category === 'calendar') === (item.category === 'calendar');
          if (sameKind) return item;
        }
      }
    }
    // 2. Magazine series + releaseDate within ±6 days
    const magMatch = cleanText.match(
      /(CanCam|FLASH|FRIDAY|B\.L\.T\.|BUBKA|BOMB|アップトゥボーイ|EX大衆|BRODY|週プレ|週刊プレイボーイ|ヤングマガジン|ヤングジャンプ|チャンピオン|スピリッツ)/i
    );
    if (magMatch && releaseDate) {
      const magToken = magMatch[1].toLowerCase();
      const targetTs = Date.parse(releaseDate);
      if (!Number.isNaN(targetTs)) {
        const hit = (catalog.items || []).find((it) => {
          if (!String(it.title || '').toLowerCase().includes(magToken)) return false;
          const itTs = Date.parse(it.releaseDate || '');
          return !Number.isNaN(itTs) && Math.abs(itTs - targetTs) <= 6 * 86400000;
        });
        if (hit) return hit;
      }
    }
    return null;
  };

  for (const item of catalog.items || []) {
    registerItemForDedup(item);
  }

  for (const pr of prItems) {
    if (existingUrls.has(pr.url)) continue;

    // Attach to existing tracked item if issueKey or tracked talent matches
    const matchedItem =
      (catalog.items || []).find(
        (it) => normalizeIssueKey(it.title) === pr.issueKey && pr.issueKey.length >= 4
      ) || findExistingItemByTalentOrMagazine(pr.title, pr.pubDate);

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

    // Auto-discover brand-new photobook / calendar / magazine releases (cap 6 per run)
    if (addedPrItems >= 6) continue;
    if (!/(写真集|カレンダー)/.test(pr.title)) continue;

    try {
      const artRes = await fetch(pr.url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!artRes.ok) continue;
      const html = await artRes.text();
      const parsed = parsePrTimesArticleHtml(html, pr);
      if (!parsed.releaseDate || !parsed.title) continue;
      if (parsed.title.length < 4 || (/！/.test(parsed.title) && parsed.title.length > 36)) continue;

      // Double-check against existing items after extracting full releaseDate & ISBN
      const matchedAfterParse =
        (parsed.isbn && (catalog.items || []).find((i) => i.isbn === parsed.isbn)) ||
        findExistingItemByTalentOrMagazine(`${parsed.title} ${parsed.headline}`, parsed.releaseDate, parsed.category);
      if (matchedAfterParse) {
        matchedAfterParse.pressArticles = matchedAfterParse.pressArticles || [];
        matchedAfterParse.pressArticles.unshift({
          title: pr.title,
          source: `PR TIMES（${pr.publisher}）`,
          url: pr.url,
          photoCountHint: '自動検出プレスリリース',
        });
        existingUrls.add(pr.url);
        addedPressArticles += 1;
        continue;
      }

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
      registerItemForDedup(newItem);
      addedPrItems += 1;
    } catch {
      // Skip transient article errors
    }
  }

  // 2) Hanmoto.com (版元ドットコム) 10 major photobook & R18 publishers' upcoming RSS + openBD batch (no login / no API key)
  try {
    const hanmotoCandidates = await fetchHanmotoPhotobookCandidates({
      fromDate: '2026-10-15',
      toDate: '2027-03-31',
      todayStr: dateStr,
    });
    console.log(
      `[collect:update] Hanmoto 10-publisher RSS + openBD -> ${hanmotoCandidates.length} relevant photobook/R18 candidate(s)`
    );

    for (const { book, r18Publisher } of hanmotoCandidates) {
      if (addedHanmotoItems >= 18) break;
      const cleanIsbn = String(book.isbn || '').replace(/[^0-9]/g, '');
      if (!cleanIsbn || existingIsbns.has(cleanIsbn)) continue;
      const newKey = normalizeIssueKey(book.title);
      if (existingKeys.has(newKey)) continue;

      const cleanTalent = normalizeTalentToken(book.talent || '');
      const monthKey = (book.releaseDate || dateStr).slice(0, 7);
      if (
        cleanTalent.length >= 2 &&
        (existingTalentCategory.has(`${cleanTalent}::${monthKey}`) ||
          existingPhotobookTalents.has(cleanTalent))
      ) {
        continue;
      }

      let verifiedCover = '';
      if (book.coverImageUrl && !existingImages.has(book.coverImageUrl)) {
        const check = await verifyImageUrl(book.coverImageUrl);
        if (check.ok) {
          verifiedCover = book.coverImageUrl;
          existingImages.add(verifiedCover);
        }
      }

      const createdItem = buildCatalogItemFromHanmoto({
        book,
        r18Publisher,
        verifiedCover,
        dateStr,
      });
      if (!createdItem) continue;
      if ((catalog.items || []).some((i) => i.id === createdItem.id)) continue;

      catalog.items.unshift(createdItem);
      registerItemForDedup(createdItem);
      addedHanmotoItems += 1;
    }
  } catch (err) {
    console.warn('[collect:update] Hanmoto sweep warning:', err?.message || err);
  }

  // 3) 7net (セブンネット) live search + Schema.org JSON-LD exclusive covers / signed books / postcards (no login / no API key)
  try {
    const sevenNetItems = await fetchSevenNetExclusiveCandidates({ maxDetailFetches: 14 });
    console.log(
      `[collect:update] 7net live exclusive bonus sweep -> ${sevenNetItems.length} detailed listing(s)`
    );

    for (const sn of sevenNetItems) {
      if (!sn.url || existingOfferUrls.has(sn.url)) continue;

      // Check if it attaches to an existing tracked magazine/photobook
      const matchedItem =
        (catalog.items || []).find((it) => {
          if (sn.isbn && it.isbn && sn.isbn === it.isbn) return true;
          return sn.issueKey && sn.issueKey.length >= 4 && normalizeIssueKey(it.title) === sn.issueKey;
        }) ||
        findExistingItemByTalentOrMagazine(sn.cleanBaseTitle, sn.releaseDate, sn.category);

      let verifiedImg = '';
      if (sn.imageUrl && !existingImages.has(sn.imageUrl)) {
        const check = await verifyImageUrl(sn.imageUrl);
        if (check.ok) {
          verifiedImg = sn.imageUrl;
          existingImages.add(verifiedImg);
        }
      }

      if (matchedItem) {
        const offerId = `${matchedItem.id}-7net-${sn.sku || Date.now()}`;
        if ((matchedItem.offers || []).some((o) => o.id === offerId || o.url === sn.url)) continue;
        matchedItem.offers = matchedItem.offers || [];
        matchedItem.offers.unshift({
          id: offerId,
          store: '7net',
          hasStoreExclusiveBonus: true,
          edition: sn.edition,
          bonusTypes: sn.bonusTypes,
          bonusText: sn.bonusText,
          talent: (matchedItem.coverTalents || [])[0] || '',
          price: Math.round(sn.price || matchedItem.price),
          status: sn.releaseDate && sn.releaseDate > dateStr ? 'preorder' : 'available',
          artworkStatus: verifiedImg ? 'revealed' : 'pending',
          ...(verifiedImg ? { imageUrl: verifiedImg } : {}),
          url: sn.url,
        });
        existingOfferUrls.add(sn.url);
        addedSevenNetOffers += 1;
        addedBonusOffers += 1;
        continue;
      }

      // Brand-new 7net exclusive title (e.g. signed photobook or new limited-cover release)
      if (addedSevenNetItems >= 6) continue;
      if (!sn.releaseDate || !sn.cleanBaseTitle) continue;
      const newKey = normalizeIssueKey(sn.cleanBaseTitle);
      if (existingKeys.has(newKey)) continue;
      if (sn.isbn && existingIsbns.has(sn.isbn)) continue;

      const itemId = `auto-7net-${sn.sku || Date.now()}`;
      if ((catalog.items || []).some((i) => i.id === itemId)) continue;

      const talent = sn.cleanBaseTitle.split(/写真集|カレンダー|『|「|\(|（|\s/)[0].trim() || '注目タレント';
      const status = sn.releaseDate > dateStr ? 'preorder' : 'available';
      const amazonUrl = buildAmazonUrlForBook(sn.isbn || sn.cleanBaseTitle, sn.cleanBaseTitle);
      const isLimitedCover = sn.bonusTypes.includes('cover');

      const offers = filterOffersByPolicy([
        {
          id: `${itemId}-7net`,
          store: '7net',
          hasStoreExclusiveBonus: true,
          edition: sn.edition,
          bonusTypes: sn.bonusTypes,
          bonusText: sn.bonusText,
          talent,
          price: sn.price,
          status,
          artworkStatus: verifiedImg ? 'revealed' : 'pending',
          ...(verifiedImg ? { imageUrl: verifiedImg } : {}),
          url: sn.url,
        },
        {
          id: `${itemId}-amazon`,
          store: 'amazon',
          hasStoreExclusiveBonus: false,
          edition: 'Amazon 通常版',
          bonusTypes: ['standard'],
          bonusText: sn.isbn
            ? `Amazonで確認（ISBN ${sn.isbn}）`
            : `Amazonで「${sn.cleanBaseTitle}」を確認`,
          talent,
          price: sn.price,
          status,
          artworkStatus: 'pending',
          url: amazonUrl,
        },
      ]);

      const newItem = {
        id: itemId,
        ...(sn.isbn ? { isbn: sn.isbn } : {}),
        title: sn.cleanBaseTitle,
        series: 'セブンネット限定発見',
        issueLabel: '7net自動発見',
        publisher: 'セブンネット掲載',
        category: sn.category,
        releaseDate: sn.releaseDate,
        price: sn.price,
        coverTalents: [talent],
        featuredTalents: [talent],
        palette:
          sn.category === 'r18'
            ? ['#881337', '#BE123C', '#FFE4E6']
            : ['#047857', '#10B981', '#ECFDF5'],
        ...(verifiedImg && isLimitedCover ? { coverImageUrl: verifiedImg } : {}),
        autoDiscovered: true,
        discoveredAt: dateStr,
        discoveredSource: '7net',
        includedBonuses: [],
        printOnlyNote: 'セブンネット公式検索より限定特典・サイン本を自動発見。基本購入先はAmazon＋限定特典ありストアのみ表示。',
        summary: sn.title,
        gallery: verifiedImg
          ? [
              {
                url: verifiedImg,
                caption: `${sn.edition}：${sn.bonusText}`,
                source: 'セブンネット',
                kind: isLimitedCover ? 'limited_cover' : 'bonus',
                articleUrl: sn.url,
              },
            ]
          : [],
        pressArticles: [],
        offers,
      };

      catalog.items.unshift(newItem);
      registerItemForDedup(newItem);
      addedSevenNetItems += 1;
    }
  } catch (err) {
    console.warn('[collect:update] 7net sweep warning:', err?.message || err);
  }

  // 4) HMV&BOOKS official Shift_JIS RSS + B.L.T.web official RSS (no login / no API key)
  try {
    const [hmvItems, bltArticles] = await Promise.all([
      fetchHmvBooksRssCandidates(),
      fetchBltWebRssArticles(),
    ]);
    console.log(
      `[collect:update] HMV RSS -> ${hmvItems.length} relevant hit(s); B.L.T.web RSS -> ${bltArticles.length} article(s)`
    );

    for (const hmv of hmvItems) {
      if (existingUrls.has(hmv.url) || existingOfferUrls.has(hmv.url)) continue;
      const matched = (catalog.items || []).find(
        (it) => hmv.issueKey && hmv.issueKey.length >= 4 && normalizeIssueKey(it.title) === hmv.issueKey
      );
      if (!matched) continue;
      if (hmv.hasHmvBonus) {
        matched.offers = matched.offers || [];
        matched.offers.unshift({
          id: `${matched.id}-hmv-rss-${Date.now()}`,
          store: 'hmv',
          hasStoreExclusiveBonus: true,
          edition: 'HMV&BOOKS限定特典',
          bonusTypes: hmv.bonusTypes,
          bonusText: hmv.title,
          talent: (matched.coverTalents || [])[0] || '',
          price: matched.price,
          status: hmv.releaseDate && hmv.releaseDate > dateStr ? 'preorder' : 'available',
          artworkStatus: 'pending',
          url: hmv.url,
        });
        existingOfferUrls.add(hmv.url);
        addedBonusOffers += 1;
      } else {
        matched.pressArticles = matched.pressArticles || [];
        matched.pressArticles.unshift({
          title: hmv.title,
          source: 'HMV&BOOKS公式',
          url: hmv.url,
          photoCountHint: '公式特集・特典情報',
        });
        existingUrls.add(hmv.url);
        addedPressArticles += 1;
      }
    }

    for (const art of bltArticles) {
      if (existingUrls.has(art.url)) continue;
      const matched = (catalog.items || []).find((it) => {
        if (!/B\.L\.T\.|blt\s*graph|BLT/i.test(it.title)) return false;
        const talentHit = (it.coverTalents || []).some((t) => {
          const clean = String(t || '').replace(/（.*?）|\(.*?\)/g, '').trim();
          return clean.length >= 2 && art.title.includes(clean);
        });
        return talentHit || (art.issueKey && normalizeIssueKey(it.title) === art.issueKey);
      });
      if (!matched) continue;
      matched.pressArticles = matched.pressArticles || [];
      matched.pressArticles.unshift({
        title: art.title,
        source: 'B.L.T.web公式',
        url: art.url,
        photoCountHint: '編集部公式カット・解禁記事',
      });
      existingUrls.add(art.url);
      addedPressArticles += 1;
    }
  } catch (err) {
    console.warn('[collect:update] HMV/B.L.T.web RSS warning:', err?.message || err);
  }

  // 5) Optional Rakuten Books API (2026 OpenAPI: activated whenever RAKUTEN_APP_ID + RAKUTEN_ACCESS_KEY are set)
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
      registerItemForDedup(createdItem);
      addedRakutenItems += 1;
    }
  } else {
    console.log(
      '[collect:update] RAKUTEN_APP_ID not set — ran full zero-key multi-site sweep (PR TIMES 15社 + 版元ドットコム10社 + セブンネット + HMV + B.L.T.web).'
    );
  }

  // 6) Refresh live multi-store stock & review status for 2022-2026 Hall-of-Fame Masterpieces
  let refreshedMasterpieces = 0;
  if (Array.isArray(catalog.masterpieces) && catalog.masterpieces.length > 0) {
    try {
      const mpRes = await refreshMasterpiecesLiveStatus(catalog.masterpieces, { dateStr });
      refreshedMasterpieces = mpRes.updatedCount || 0;
      catalog.masterpiecesCheckedAt = timestampJst;
      console.log(
        `[collect:update] Masterpieces live stock check -> ${refreshedMasterpieces} title(s) refreshed${
          mpRes.rakutenBackedOff ? ' (Rakuten backed off; used Kinokuniya/7net)' : ''
        }`
      );
    } catch (err) {
      console.warn('[collect:update] Masterpieces stock check non-fatal error:', err.message);
    }
  }

  // Enforce noise-free store policy across every item and masterpiece before saving
  for (const item of [...(catalog.items || []), ...(catalog.masterpieces || [])]) {
    item.offers = filterOffersByPolicy(item.offers || []);
  }

  const totalNewItems = addedPrItems + addedHanmotoItems + addedSevenNetItems + addedRakutenItems;
  catalog.referenceDate = dateStr;
  catalog.lastAutoCheckedAt = timestampJst;
  catalog.autoSources = {
    prtimesPublishers: PRTIMES_PUBLISHER_FEEDS.length,
    hanmotoPublishers: HANMOTO_PUBLISHER_FEEDS.length,
    sevenNetLive: true,
    hmvRssLive: true,
    bltWebRssLive: true,
    masterpiecesStockLive: refreshedMasterpieces > 0,
    rakutenApiConnected: Boolean(appId),
    rakutenOpenApi2026: rakutenReady,
    lastRunAt: timestampJst,
    lastRunSummary: `PR TIMES 15社(+${addedPrItems}) / 版元ドットコム10社(+${addedHanmotoItems}) / 7net(+${addedSevenNetItems}作品・+${addedSevenNetOffers}特典) / HMV・BLT(+${addedPressArticles}記事) / 名作在庫(${refreshedMasterpieces}作品更新)${
      appId ? ` / 楽天API(+${addedRakutenItems})` : ''
    }`,
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
    `[collect:update] Done! referenceDate=${dateStr}, +${totalNewItems} new items (PR:${addedPrItems}, Hanmoto:${addedHanmotoItems}, 7net:${addedSevenNetItems}, Rakuten:${addedRakutenItems}), +${addedBonusOffers} bonus offers (7net:${addedSevenNetOffers}), +${addedPressArticles} press, masterpiecesChecked=${refreshedMasterpieces}, nonAmazonNonBonus=${report.nonAmazonNonBonus}`
  );

  writeGitHubStepSummary([
    '## 🤖 Happy Magazine Center Daily Auto-Update Summary',
    `- **基準日 (JST)**: \`${dateStr}\``,
    `- **PR TIMES 15出版社**: +${addedPrItems} 新刊`,
    `- **版元ドットコム 10主要写真集・R18版元＋openBD**: +${addedHanmotoItems} 新刊`,
    `- **セブンネット限定表紙・サイン本・特典**: +${addedSevenNetItems} 新刊 / +${addedSevenNetOffers} 限定特典追加`,
    `- **HMV&BOOKS RSS ＋ B.L.T.web RSS**: +${addedPressArticles} 記事 / 合計 +${addedBonusOffers} 特典`,
    `- **🏆 名作・殿堂（2022〜2026）ライブ在庫チェック**: ${refreshedMasterpieces} 作品を紀伊國屋ウェブストア・楽天ブックス・7netで更新`,
    `- **楽天ブックスAPI (2026 OpenAPI)**: ${
      rakutenReady
        ? `✅ 連携稼働中 (+${addedRakutenItems} 新刊)`
        : '🔑 未設定（無料・任意で後日追加可能）'
    }`,
    `- **カタログ総数**: **${report.totalItems} 新刊作品** ＋ **${report.totalMasterpieces || 0} 殿堂名作** / **${report.totalOffers} オファー**（非Amazon無特典: **${report.nonAmazonNonBonus} 件**）`,
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
