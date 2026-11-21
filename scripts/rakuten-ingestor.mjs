/**
 * Rakuten Books API Multi-Genre Harvester & Policy-Compliant Builder (v1.0)
 *
 * Activated automatically whenever the free `RAKUTEN_APP_ID` secret is configured
 * in GitHub Actions (Settings -> Secrets and variables -> Actions -> RAKUTEN_APP_ID).
 *
 * Covers:
 *   1) 16 major idol / gravure / weekly / R18 magazines (BooksMagazine API)
 *   2) Photobooks (001013001), Talent/Gravure (001013002), R18 Adult Books (001014),
 *      2027 Calendars, and Rakuten-exclusive bonus photobooks (BooksBook API)
 *
 * Strictly obeys the Noise-Free Store Policy (`nonAmazonNonBonus === 0`):
 *   - Amazon base offer is ALWAYS generated (using direct `/dp/<ISBN10>` when ISBN-13 is available).
 *   - Rakuten Books offer is included ONLY when `hasStoreExclusiveBonus === true`.
 */

import { isbn13To10 } from '../src/isbn-lookup.js';
import { filterOffersByPolicy } from './normalizer.mjs';
import { isTargetReleaseTitle } from './prtimes-ingestor.mjs';

export const RAKUTEN_MAGAZINE_API =
  'https://app.rakuten.co.jp/services/api/BooksMagazine/Search/20170404';
export const RAKUTEN_BOOK_API =
  'https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404';

export const RAKUTEN_MAGAZINE_KEYWORDS = [
  'B.L.T.',
  'BOMB',
  'アップトゥボーイ',
  'BUBKA',
  'EX大衆',
  'BRODY',
  '週刊プレイボーイ',
  'FLASH',
  'FRIDAY',
  '週刊少年チャンピオン',
  'ヤングマガジン',
  'ヤングジャンプ',
  'ビッグコミックスピリッツ',
  'グラビアザテレビジョン',
  'グラビアチャンピオン',
  '月刊FANZA',
];

export const RAKUTEN_BOOK_QUERIES = [
  { label: 'アイドル・グラビア写真集', params: { booksGenreId: '001013001', sort: '-releaseDate', hits: 30 }, isR18: false, isPhotobookGenre: true },
  { label: 'タレント・グラビア本', params: { booksGenreId: '001013002', sort: '-releaseDate', hits: 20 }, isR18: false, isPhotobookGenre: true },
  { label: '🔞 アダルト・R18写真集', params: { booksGenreId: '001014', sort: '-releaseDate', hits: 30 }, isR18: true, isPhotobookGenre: true },
  { label: '2027カレンダー', params: { title: 'カレンダー 2027', sort: '-releaseDate', hits: 20 }, isR18: false, isPhotobookGenre: false },
  { label: '楽天限定特典 写真集', params: { title: '楽天ブックス限定特典 写真集', sort: '-releaseDate', hits: 20 }, isR18: false, isPhotobookGenre: true },
];

const MALE_OR_NOISE_RE =
  /(デジタル|電子書籍|電子版|Kindle|俳優|男性|ボーイズ|メンズ|MEN'S|JO1|INI|timelesz|M!LK|FANTASTICS|BE:FIRST|SixTONES|Snow\s*Man|なにわ男子|Travis\s*Japan|Hey!\s*Say!|King\s*&\s*Prince|Aぇ!\s*group|プロレス|野球|サッカー|競馬|将棋|将棋年鑑|鉄道|電車|風景写真|猫写真|犬写真|児童|絵本|コミック|マンガ|漫画|BL|ボーイズラブ|乙女)/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

/**
 * Normalizes Rakuten Books `salesDate` formats into YYYY-MM-DD:
 *   - "2026年12月15日" / "2026年12月15日頃" -> "2026-12-15"
 *   - "2026年12月上旬" -> "2026-12-05"
 *   - "2026年12月中旬" -> "2026-12-15"
 *   - "2026年12月下旬" -> "2026-12-25"
 *   - "2026年12月" / "2026年12月頃" -> "2026-12-01"
 */
export function parseRakutenSalesDate(raw = '') {
  const s = String(raw || '').trim();
  const full = s.match(/(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (full) {
    return `${full[1]}-${pad2(full[2])}-${pad2(full[3])}`;
  }
  const vague = s.match(/(202[567])年\s*(\d{1,2})月\s*(上旬|中旬|下旬)?/);
  if (vague) {
    const day = vague[3] === '上旬' ? '05' : vague[3] === '中旬' ? '15' : vague[3] === '下旬' ? '25' : '01';
    return `${vague[1]}-${pad2(vague[2])}-${day}`;
  }
  return '';
}

/**
 * Upgrades Rakuten Books thumbnail URLs (`?_ex=200x200`) to high-resolution 600x600 covers.
 */
export function upgradeRakutenImageUrl(url = '') {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/thumbnail\.image\.rakuten\.co\.jp/i.test(s)) {
    return s.replace(/\?_ex=\d+x\d+/i, '?_ex=600x600');
  }
  return s;
}

/**
 * Determines whether a Rakuten Books record is a relevant physical idol/gravure/photobook/
 * calendar/R18 release (excluding male-actor, digital-only, manga, and hobby photo noise).
 */
export function isRelevantRakutenRecord(record) {
  const title = String(record?.title || '').trim();
  const desc = String(record?.description || '').trim();
  if (!title) return false;
  if (MALE_OR_NOISE_RE.test(`${title} ${desc.slice(0, 120)}`)) return false;
  if (record.isR18) return true;
  if (record.isPhotobookGenre && /写真集|フォトブック|フォトエッセイ|カレンダー|グラビア|水着|ランジェリー|ビキニ/.test(`${title} ${desc}`)) {
    return true;
  }
  return isTargetReleaseTitle(title);
}

/**
 * Builds a policy-compliant (`nonAmazonNonBonus === 0`) catalog item from a Rakuten Books record.
 */
export function buildCatalogItemFromRakuten({
  raw,
  bonusOffers = [],
  verifiedCover = '',
  dateStr = '2026-11-21',
}) {
  const cleanTitle = String(raw.title || '')
    .replace(/【楽天ブックス限定特典】/g, '')
    .replace(/\([^)]*(?:生写真|ポストカード|ブロマイド|クリアファイル|ポスター|限定特典)[^)]*\)\s*$/g, '')
    .trim();

  const isbn13 = String(raw.isbn || '').replace(/[^0-9]/g, '');
  const isbn10 = isbn13To10(isbn13);
  const amazonUrl = isbn10
    ? `https://www.amazon.co.jp/dp/${isbn10}`
    : `https://www.amazon.co.jp/s?k=${encodeURIComponent(isbn13 || cleanTitle)}&i=stripbooks`;

  const relDate = parseRakutenSalesDate(raw.releaseDate);
  if (!cleanTitle || !relDate) return null;

  const category = raw.isR18
    ? 'r18'
    : /カレンダー/.test(cleanTitle)
      ? 'calendar'
      : /B\.L\.T\.|BOMB|アップトゥボーイ|BUBKA|EX大衆|BRODY/i.test(cleanTitle)
        ? 'idol'
        : /プレイボーイ|FLASH|FRIDAY|チャンピオン|ヤングマガジン|ヤングジャンプ|スピリッツ/i.test(cleanTitle)
          ? 'weekly'
          : 'photobook';

  const talent =
    String(raw.author || '')
      .split(/[,、／/\s]+/)
      .map((s) => s.trim())
      .find((s) => s && !/^(著|撮影|写真|編集)$/.test(s)) ||
    cleanTitle.split(/[『「\s]/)[0] ||
    '注目タレント';

  const price = Number(raw.price) || (category === 'photobook' ? 3520 : category === 'calendar' ? 3300 : 1200);
  const newId = `auto-rb-${isbn13 || Date.now()}`;
  const status = relDate > dateStr ? 'preorder' : 'available';

  const offers = [];
  for (const bonusOffer of bonusOffers) {
    if (bonusOffer.store === 'rakuten' && bonusOffer.hasStoreExclusiveBonus === true) {
      offers.push({
        id: `${newId}-rakuten`,
        store: 'rakuten',
        hasStoreExclusiveBonus: true,
        edition: '楽天ブックス限定特典',
        bonusTypes: bonusOffer.bonusTypes?.length ? bonusOffer.bonusTypes : ['photo'],
        bonusText: bonusOffer.bonusText || '楽天ブックス限定特典付き',
        talent,
        price: bonusOffer.price || price,
        status,
        artworkStatus: 'pending',
        url: bonusOffer.url || raw.url,
      });
    }
  }

  offers.push({
    id: `${newId}-amazon`,
    store: 'amazon',
    hasStoreExclusiveBonus: false,
    edition: 'Amazon 通常版',
    bonusTypes: ['standard'],
    bonusText: isbn13 ? `Amazonで確認（ISBN ${isbn13}）` : `Amazonで「${cleanTitle}」を確認`,
    talent,
    price,
    status,
    artworkStatus: verifiedCover ? 'revealed' : 'pending',
    ...(verifiedCover ? { imageUrl: verifiedCover } : {}),
    url: amazonUrl,
  });

  return {
    id: newId,
    ...(isbn13 ? { isbn: isbn13 } : {}),
    title: cleanTitle,
    series: raw.publisher || '楽天ブックス新刊',
    issueLabel: '楽天API自動発見',
    publisher: raw.publisher || '出版社公式',
    category,
    releaseDate: relDate,
    price,
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
    printOnlyNote: '楽天ブックスAPIより自動発見。基本購入先はAmazon、限定特典ありストアのみ表示。',
    summary: raw.description ? String(raw.description).replace(/\s+/g, ' ').trim().slice(0, 150) : cleanTitle,
    gallery: verifiedCover
      ? [
          {
            url: verifiedCover,
            caption: `${cleanTitle} 公式書影`,
            source: '楽天ブックス公式書影',
            kind: 'cover',
            articleUrl: amazonUrl,
          },
        ]
      : [],
    pressArticles: [],
    offers: filterOffersByPolicy(offers),
  };
}

/**
 * Fetches live magazine, photobook, calendar, and R18 records from Rakuten Books API.
 */
export async function fetchRakutenCatalogRecords(appId) {
  if (!appId) return [];
  const results = [];
  const seenKeys = new Set();

  const pushUnique = (rec) => {
    const key = `${rec.isbn || ''}|${rec.url || rec.title}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push(rec);
  };

  for (const kw of RAKUTEN_MAGAZINE_KEYWORDS) {
    try {
      const url = `${RAKUTEN_MAGAZINE_API}?applicationId=${encodeURIComponent(
        appId
      )}&title=${encodeURIComponent(kw)}&sort=-releaseDate&hits=6`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const json = await res.json();
        for (const entry of json.Items || []) {
          const item = entry.Item;
          pushUnique({
            store: 'rakuten',
            title: item.title,
            description: item.itemCaption || '',
            releaseDate: item.salesDate || '',
            price: item.itemPrice || 0,
            url: item.itemUrl,
            imageUrl: upgradeRakutenImageUrl(item.largeImageUrl || ''),
            isbn: item.jan || '',
            publisher: item.publisherName || '',
            author: '',
            isR18: kw === '月刊FANZA',
            isPhotobookGenre: false,
          });
        }
      }
    } catch {
      // Non-fatal network error per keyword
    }
    await sleep(180);
  }

  for (const q of RAKUTEN_BOOK_QUERIES) {
    try {
      const qs = new URLSearchParams({ applicationId: appId, ...q.params });
      const res = await fetch(`${RAKUTEN_BOOK_API}?${qs.toString()}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        for (const entry of json.Items || []) {
          const item = entry.Item;
          pushUnique({
            store: 'rakuten',
            title: item.title,
            description: item.itemCaption || '',
            releaseDate: item.salesDate || '',
            price: item.itemPrice || 0,
            url: item.itemUrl,
            imageUrl: upgradeRakutenImageUrl(item.largeImageUrl || ''),
            isbn: item.isbn || '',
            publisher: item.publisherName || '',
            author: item.author || '',
            isR18: q.isR18,
            isPhotobookGenre: q.isPhotobookGenre,
          });
        }
      }
    } catch {
      // Non-fatal network error per genre query
    }
    await sleep(180);
  }

  return results;
}
