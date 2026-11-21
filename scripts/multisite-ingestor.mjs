/**
 * Multi-Site Zero-Login Daily Discovery Engine (v1.1)
 *
 * Expands daily automated ingestion far beyond PR TIMES without requiring any API keys or logins:
 *   1) Hanmoto.com (版元ドットコム) official upcoming-release RSS across 10 major photobook & R18 publishers
 *      + batch openBD metadata enrichment -> exact ISBN-13, Amazon /dp/<ISBN10>, and official hanmoto covers
 *   2) 7net (セブンネットショッピング) live search + Schema.org JSON-LD Product extractor
 *      -> catches exclusive limited covers, postcards, and retail signed editions (サイン本)
 *   3) HMV&BOOKS official books RSS (Shift_JIS) -> catches HMV-exclusive bonuses & photobook launches
 *   4) B.L.T.web official RSS -> attaches official cover reveals & gravure previews to B.L.T. issues
 *
 * Strictly enforces the Noise-Free Store Policy (`nonAmazonNonBonus === 0`).
 */

import { isbn13To10, parseOpenBdRecord } from '../src/isbn-lookup.js';
import { filterOffersByPolicy, normalizeIssueKey, parseBonusInfo } from './normalizer.mjs';

export const HANMOTO_PUBLISHER_FEEDS = [
  { publisher: '彩文館出版', queryPub: '彩文館', r18Publisher: true },
  { publisher: 'ジーウォーク', queryPub: 'ジーウォーク', r18Publisher: true },
  { publisher: 'ジーオーティー', queryPub: 'ジーオーティー', r18Publisher: true },
  { publisher: '双葉社', queryPub: '双葉社', r18Publisher: false },
  { publisher: '竹書房', queryPub: '竹書房', r18Publisher: false },
  { publisher: 'ワニブックス', queryPub: 'ワニブックス', r18Publisher: false },
  { publisher: '講談社', queryPub: '講談社', r18Publisher: false },
  { publisher: '集英社', queryPub: '集英社', r18Publisher: false },
  { publisher: '光文社', queryPub: '光文社', r18Publisher: false },
  { publisher: '秋田書店', queryPub: '秋田書店', r18Publisher: false },
];

export const SEVENNET_SEARCH_QUERIES = [
  'セブンネット限定表紙',
  'セブンネット限定 サイン本',
  'セブンネット限定 ポストカード',
];

export const HMV_BOOKS_RSS_URL = 'https://www.hmv.co.jp/rss/news/books/';
export const BLTWEB_RSS_URL = 'https://bltweb.jp/feed/';

const NOISE_OR_MALE_RE =
  /(デジタル写真集|デジタル限定|電子写真集|電子書籍|電子版|Kindle|俳優|男性|男子|ボーイズ|メンズ|MEN'S|JO1|INI|timelesz|M!LK|FANTASTICS|GENERATIONS|EXILE|BE:FIRST|SixTONES|Snow\s*Man|なにわ男子|Travis\s*Japan|King\s*&\s*Prince|Aぇ!\s*group|SHOW-WA|MATSURI|WILD\s*BLUE|SUPER\s*DRAGON|ONE\s*N'ONLY|原因は自分にある|超特急|岡本信彦|羽生結弦|奥野壮|中川翼|東啓介|新浜レオン|白岩瑠姫|湯本健一|榎田一王|中務裕太|今井竜太郎|永瀬廉|岩瀬洋志|ディーン・フジオカ|石原知哉|中沢元紀|駒木根葵汰|庄司浩平|塩野瑛久|水沢林太郎|山下幸輝|綱啓永|樋口幸平|杢代和人|高橋文哉|宮世琉弥|板垣李光人|黒羽麻璃央|高野洸|荒牧慶彦|佐藤流司|和田雅成|なつめさんち|今日、好きになりました|仮面ライダー|ウルトラマン|プロレス|野球|サッカー|競馬|将棋|鉄道|電車|風景|猫|犬|動物|鳥|ムーミン|ポケモン|ちいかわ|すみっコ|ディズニー|絵日記|絵本|児童|幼児|レシピ|料理|BL|ボーイズラブ|乙女|韓流ぴあ|SEVENTEEN|BTS|Stray\s*Kids|TREASURE|NCT|TXT|ENHYPEN|ATEEZ|ZEROBASEONE|AHOF|コミック|漫画|マンガ|小説|ノベル|戦争|軍事|兵器|図鑑|年表|タイムライン)/i;

const FEMALE_GRAVURE_OR_IDOL_SIGNAL_RE =
  /(写真集|フォトブック|グラビア|水着|ランジェリー|ビキニ|ヘアヌード|ヌード|セクシー|女優|アイドル|モデル|コスプレ|B\.L\.T\.|blt\s*graph|BOMB|アップトゥボーイ|BUBKA|BRODY|EX大衆|FLASH|FRIDAY|週プレ|チャンピオン|ヤングマガジン|ヤングジャンプ|スピリッツ|SPA!|乃木坂46|櫻坂46|日向坂46|AKB48|SKE48|NMB48|HKT48|NGT48|STU48|僕が見たかった青空|FRUITS\s*ZIPPER|CANDY\s*TUNE|=LOVE|≠ME|≒JOY|ラブライブ|Liella|声優|ポストカード|生写真|限定表紙|サイン本)/i;

const R18_PUBLISHER_OR_KEYWORD_RE =
  /(彩文館|ジーウォーク|ジーオーティー|ヘアヌード|オールヌード|ヌード写真集|豪華愛蔵版|R18|アダルト|FANZA|官能|裸身|Mの誘惑|癒しのカンケイ|呼吸|しばしとどめむ|そばにいたい|ぜんぶキミのせい|美の余韻|澄みわたる|ちゅらり|境界線|愛して、藍|白上咲花|夕季ちとせ|北村海智|風間ゆみ|真木今日子|結城花乃羽|神宮寺ナオ|比留川マイ|矢埜愛茉|希望みう|向井藍|あんづ杏)/i;

function decodeHtmlEntities(str = '') {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

function parseRfc2822ToJstDate(str = '') {
  const s = String(str || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function extractTalentFromTitle(title = '') {
  const normalized = String(title || '').normalize('NFKC');
  const m = normalized.match(
    /(?:^|[:：／/\s『「【])([^\s:：／/『』「」【】()（）]{2,14}?)\s*(?:1st|2nd|3rd|4th|5th|ファースト|セカンド|サード|最新|待望の|メモリアル|卒業|202\d年)?\s*(?:写真集|フォトブック|フォトエッセイ|スタイルブック|カレンダー)/i
  );
  if (m && m[1] && !/^(豪華愛蔵版|完全|特別|限定|デジタル|ヘアヌード|ヌード)$/.test(m[1].trim())) {
    return m[1].trim();
  }
  return normalized.split(/写真集|カレンダー|『|「|\(|（|\s/)[0].trim() || '注目タレント';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   1. Hanmoto.com (版元ドットコム) Upcoming RSS + openBD Batch
   ========================================================= */
export function buildHanmotoRssUrl({ queryPub, fromDate, toDate }) {
  return `https://www.hanmoto.com/ci/bd/search/title/${encodeURIComponent(
    '写真集'
  )}/publisher/${encodeURIComponent(queryPub)}/sdate/${fromDate}/edate/${toDate}/order/desc/vw/rss20`;
}

export function parseHanmotoRssXml(xml = '') {
  const items = [];
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const m of blocks) {
    const body = m[1];
    const rssTitle = decodeHtmlEntities(
      ((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const link = ((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const pubDateRaw = ((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    const descRaw = decodeHtmlEntities(
      ((body.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const isbn = (link.match(/9784\d{9}/) || [])[0] || '';
    if (!isbn || !rssTitle) continue;

    // Extract clean title from "夕季ちとせ写真集 - 篠原 潔(写真) | ジーウォーク"
    const cleanTitle = rssTitle
      .replace(/\s*\|\s*[^|]+$/, '')
      .replace(/\s+-\s+[^-]+$/, '')
      .trim();

    // Prefer Japanese "発売予定日 2027年1月26日" in description, then RFC-2822 <pubDate>
    const jpDate = descRaw.match(/発売(?:予定)?日\s*(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日/);
    const releaseDate = jpDate
      ? `${jpDate[1]}-${pad2(jpDate[2])}-${pad2(jpDate[3])}`
      : parseRfc2822ToJstDate(pubDateRaw);

    items.push({
      isbn,
      rssTitle,
      cleanTitle: cleanTitle || rssTitle,
      releaseDate,
      rssDesc: descRaw.slice(0, 180),
      hanmotoUrl: link,
    });
  }
  return items;
}

export function isRelevantHanmotoBook(book, { r18Publisher = false } = {}) {
  const title = String(book?.title || '').trim();
  const desc = String(book?.description || '').trim();
  if (!title || /^タイトル未定$/i.test(title) || /『\s*タイトル未定\s*』/.test(title)) return false;
  if (NOISE_OR_MALE_RE.test(`${title} ${desc.slice(0, 220)}`)) return false;
  if (r18Publisher) return /写真集|フォトブック|PHOTOBOOK|ヌード/i.test(`${title} ${desc}`);
  return FEMALE_GRAVURE_OR_IDOL_SIGNAL_RE.test(`${title} ${desc}`);
}

export function buildCatalogItemFromHanmoto({
  book,
  r18Publisher = false,
  verifiedCover = '',
  dateStr = '2026-11-21',
}) {
  if (!book || !book.isbn || !book.title) return null;
  const isbn13 = String(book.isbn).replace(/[^0-9]/g, '');
  const isbn10 = isbn13To10(isbn13);
  const amazonUrl = isbn10
    ? `https://www.amazon.co.jp/dp/${isbn10}`
    : `https://www.amazon.co.jp/s?k=${encodeURIComponent(isbn13)}&i=stripbooks`;

  const relDate = book.releaseDate || dateStr;
  const isR18 =
    r18Publisher ||
    book.category === 'r18' ||
    R18_PUBLISHER_OR_KEYWORD_RE.test(`${book.title} ${book.publisher} ${book.description || ''}`);
  const category = isR18 ? 'r18' : /カレンダー/.test(book.title) ? 'calendar' : 'photobook';
  const id = `auto-hm-${isbn13}`;
  const status = relDate > dateStr ? 'preorder' : 'available';
  const price = Math.round(Number(book.price) || (isR18 ? 4180 : 3520));
  const talent = book.talent || extractTalentFromTitle(book.title);

  const offers = filterOffersByPolicy([
    {
      id: `${id}-amazon`,
      store: 'amazon',
      hasStoreExclusiveBonus: false,
      edition: 'Amazon 通常版',
      bonusTypes: ['standard'],
      bonusText: `Amazonで確認（ISBN ${isbn13}）`,
      talent,
      price,
      status,
      artworkStatus: verifiedCover ? 'revealed' : 'pending',
      ...(verifiedCover ? { imageUrl: verifiedCover } : {}),
      url: amazonUrl,
    },
  ]);

  return {
    id,
    isbn: isbn13,
    title: book.title,
    series: book.publisher || '版元ドットコム新刊',
    issueLabel: '版元ドットコム自動発見',
    publisher: book.publisher || '出版社公式',
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
    discoveredSource: 'hanmoto',
    includedBonuses: [],
    printOnlyNote: `${book.publisher || '版元ドットコム'}近刊RSSより自動発見。基本購入先はAmazon（他ストアは限定特典確認時のみ表示）。`,
    summary: book.description || `${book.publisher || '出版社公式'}より発売の注目${category === 'r18' ? 'R18' : ''}写真集。`,
    gallery: verifiedCover
      ? [
          {
            url: verifiedCover,
            caption: `${book.title} 公式書影`,
            source: '版元ドットコム / openBD',
            kind: 'cover',
            articleUrl: amazonUrl,
          },
        ]
      : [],
    pressArticles: [
      {
        title: `${book.title}（版元ドットコム書誌ページ）`,
        source: '版元ドットコム',
        url: `https://www.hanmoto.com/bd/isbn/${isbn13}`,
        photoCountHint: '公式書誌情報',
      },
    ],
    offers,
  };
}

export async function fetchHanmotoPhotobookCandidates({
  fromDate = '2026-10-15',
  toDate = '2027-03-31',
  todayStr = '2026-11-21',
} = {}) {
  const byIsbn = new Map();

  for (const feed of HANMOTO_PUBLISHER_FEEDS) {
    try {
      const url = buildHanmotoRssUrl({ queryPub: feed.queryPub, fromDate, toDate });
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const entry of parseHanmotoRssXml(xml)) {
        if (!byIsbn.has(entry.isbn)) {
          byIsbn.set(entry.isbn, { ...entry, feed });
        }
      }
    } catch {
      // Non-fatal network error per publisher
    }
    await sleep(120);
  }

  const allIsbns = [...byIsbn.keys()];
  const candidates = [];

  // Batch-enrich with openBD (25 ISBNs per request), falling back cleanly to Hanmoto RSS for brand-new upcoming releases
  for (let i = 0; i < allIsbns.length; i += 25) {
    const chunk = allIsbns.slice(i, i + 25);
    let records = new Array(chunk.length).fill(null);
    try {
      const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${chunk.join(',')}`, {
        signal: AbortSignal.timeout(9000),
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) records = json;
      }
    } catch {
      // Non-fatal; fall back to Hanmoto RSS metadata
    }

    chunk.forEach((isbn, idx) => {
      const meta = byIsbn.get(isbn);
      if (!meta) return;
      const rec = records[idx];
      let parsed = rec ? parseOpenBdRecord(rec, isbn) : null;

      if (!parsed) {
        const isR18 =
          meta.feed.r18Publisher || R18_PUBLISHER_OR_KEYWORD_RE.test(`${meta.cleanTitle} ${meta.rssDesc}`);
        parsed = {
          isbn,
          title: meta.cleanTitle,
          talent: extractTalentFromTitle(meta.cleanTitle),
          publisher: meta.feed.publisher,
          releaseDate: meta.releaseDate || '',
          price: isR18 ? 4180 : 3520,
          category: isR18 ? 'r18' : /カレンダー/.test(meta.cleanTitle) ? 'calendar' : 'photobook',
          description: meta.rssDesc || `${meta.feed.publisher}近刊写真集。`,
          coverImageUrl: `https://img.hanmoto.com/bd/img/${isbn}.jpg`,
        };
      } else {
        if (!parsed.publisher || parsed.publisher === '出版社公式') {
          parsed.publisher = meta.feed.publisher;
        }
        // Always prefer exact Hanmoto RSS 発売予定日 when openBD pubdate is blank or coarse YYYY-MM-01
        if (meta.releaseDate && (!parsed.releaseDate || parsed.releaseDate.endsWith('-01'))) {
          parsed.releaseDate = meta.releaseDate;
        }
      }

      if (parsed.releaseDate && parsed.releaseDate < fromDate) return;
      if (!isRelevantHanmotoBook(parsed, { r18Publisher: meta.feed.r18Publisher })) return;

      candidates.push({
        book: parsed,
        r18Publisher: meta.feed.r18Publisher,
      });
    });
  }

  // Prioritize upcoming releases (todayStr <= releaseDate) soonest first, then newest already-released titles
  candidates.sort((a, b) => {
    const da = a.book.releaseDate || '9999-99-99';
    const db = b.book.releaseDate || '9999-99-99';
    const aUpcoming = da >= todayStr ? 0 : 1;
    const bUpcoming = db >= todayStr ? 0 : 1;
    if (aUpcoming !== bUpcoming) return aUpcoming - bUpcoming;
    if (aUpcoming === 0) return da.localeCompare(db);
    return db.localeCompare(da);
  });

  return candidates;
}

/* =========================================================
   2. 7net (セブンネットショッピング) Exclusive Bonus Harvester
   ========================================================= */
export function isRelevantSevenNetListing(title = '') {
  const t = String(title || '').trim();
  if (!t) return false;
  if (!/セブンネット限定|限定表紙|限定カバー|直筆サイン本/.test(t)) return false;
  if (NOISE_OR_MALE_RE.test(t)) return false;
  return FEMALE_GRAVURE_OR_IDOL_SIGNAL_RE.test(t);
}

export function parseSevenNetSearchHtml(html = '') {
  const results = [];
  const seen = new Set();
  const linkMatches = [
    ...String(html || '').matchAll(
      /<a[^>]+href=["'](\/detail\/(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a>/gi
    ),
  ];
  for (const m of linkMatches) {
    const sku = m[2];
    const url = `https://7net.omni7.jp${m[1]}`;
    const title = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (!title || title.length < 6 || seen.has(sku)) continue;
    seen.add(sku);
    if (!isRelevantSevenNetListing(title)) continue;
    results.push({ sku, url, title, issueKey: normalizeIssueKey(title) });
  }
  return results;
}

export function parseSevenNetProductHtml(html = '', url = '') {
  const raw = String(html || '');
  let product = null;
  const ldBlocks = [
    ...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const m of ldBlocks) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && parsed['@type'] === 'Product') {
        product = parsed;
        break;
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  const title = decodeHtmlEntities(
    product?.name ||
      ((raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '')
  ).trim();
  if (!title) return null;

  const images = Array.isArray(product?.image)
    ? product.image.filter(Boolean)
    : product?.image
      ? [product.image]
      : [];
  const primaryImage = String(images[0] || '').trim();
  const price = Math.round(
    Number(product?.offers?.price || product?.offers?.[0]?.price) ||
      Number(((raw.match(/([0-9,]{3,6})円[（(]税込/) || [])[1] || '').replace(/,/g, '')) ||
      0
  );

  const relMatch = raw.match(/発売日[\s\S]{0,140}?(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const releaseDate = relMatch ? `${relMatch[1]}-${pad2(relMatch[2])}-${pad2(relMatch[3])}` : '';

  const sku = String(product?.sku || (url.match(/\/detail\/(\d+)\.html/) || [])[1] || '').trim();
  const isbnMatch = raw.match(/978[-]?4[-]?\d{9}|978[-]?4[-]\d{2,5}[-]\d{2,5}[-]\d/);
  const isbn = isbnMatch ? isbnMatch[0].replace(/[^0-9]/g, '') : '';

  const bonusInfo = parseBonusInfo(title, '');
  const isSigned = bonusInfo.bonusTypes.includes('signed') || /直筆サイン本|サイン本/.test(title);
  const isLimitedCover = bonusInfo.bonusTypes.includes('cover') || /限定表紙|限定カバー/.test(title);

  const bonusBracketMatch = title.match(/【([^】]*セブンネット限定[^】]*)】/);
  const coverVerMatch = title.match(/[「『]([^」』]+ver\.?)[」』]/i);
  const bonusText =
    [coverVerMatch ? `限定表紙：${coverVerMatch[1]}` : '', bonusBracketMatch ? bonusBracketMatch[1] : '']
      .filter(Boolean)
      .join(' ＋ ') || title;

  const cleanBaseTitle = title
    .replace(/\s*セブンネット限定表紙版\s*[「『][^」』]+[」』]/g, '')
    .replace(/\s*【[^】]*】/g, '')
    .trim();

  let category = 'gravure';
  if (R18_PUBLISHER_OR_KEYWORD_RE.test(title)) category = 'r18';
  else if (/カレンダー/.test(cleanBaseTitle)) category = 'calendar';
  else if (/写真集|フォトブック/.test(cleanBaseTitle)) category = 'photobook';
  else if (/B\.L\.T\.|BOMB|アップトゥボーイ|BUBKA|EX大衆|BRODY/i.test(cleanBaseTitle)) category = 'idol';
  else if (/プレイボーイ|FLASH|FRIDAY|チャンピオン|スピリッツ|ヤングマガジン|ヤングジャンプ|SPA!/i.test(cleanBaseTitle)) {
    category = 'weekly';
  }

  return {
    sku,
    url,
    title,
    cleanBaseTitle,
    issueKey: normalizeIssueKey(cleanBaseTitle || title),
    releaseDate,
    price: price || (category === 'photobook' ? 3520 : 1430),
    isbn,
    imageUrl: primaryImage,
    bonusTypes: bonusInfo.bonusTypes.length ? bonusInfo.bonusTypes : ['photo'],
    bonusText,
    edition: isSigned
      ? 'セブンネット限定・直筆サイン本'
      : isLimitedCover
        ? 'セブンネット限定表紙＋特典'
        : 'セブンネット限定特典',
    category,
  };
}

export async function fetchSevenNetExclusiveCandidates({ maxDetailFetches = 10 } = {}) {
  const discovered = new Map();

  for (const q of SEVENNET_SEARCH_QUERIES) {
    try {
      const url = `https://7net.omni7.jp/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      for (const item of parseSevenNetSearchHtml(html)) {
        if (!discovered.has(item.sku)) {
          discovered.set(item.sku, item);
        }
      }
    } catch {
      // Non-fatal
    }
    await sleep(150);
  }

  const detailed = [];
  for (const stub of [...discovered.values()].slice(0, maxDetailFetches)) {
    try {
      const res = await fetch(stub.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseSevenNetProductHtml(html, stub.url);
      if (parsed) detailed.push(parsed);
    } catch {
      // Non-fatal
    }
    await sleep(150);
  }

  return detailed;
}

/* =========================================================
   3. HMV&BOOKS Official Books RSS (Shift_JIS)
   ========================================================= */
export function parseHmvRssXml(xml = '') {
  const items = [];
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const m of blocks) {
    const body = m[1];
    const title = decodeHtmlEntities(
      ((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim()
    );
    const url = ((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    if (!title || !url) continue;
    if (NOISE_OR_MALE_RE.test(title)) continue;
    if (!FEMALE_GRAVURE_OR_IDOL_SIGNAL_RE.test(title)) continue;
    if (!/HMV|限定特典|限定表紙|ポストカード|生写真|ブロマイド|サイン本|写真集|カレンダー/.test(title)) {
      continue;
    }

    const bonusInfo = parseBonusInfo(title, '');
    const dateMatch = title.match(/(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日/);
    const releaseDate = dateMatch ? `${dateMatch[1]}-${pad2(dateMatch[2])}-${pad2(dateMatch[3])}` : '';

    items.push({
      title,
      url,
      releaseDate,
      issueKey: normalizeIssueKey(title),
      hasHmvBonus: /HMV.*特典|限定特典|限定表紙|サイン本|ポストカード|生写真|ブロマイド/.test(title),
      bonusTypes: bonusInfo.bonusTypes.length ? bonusInfo.bonusTypes : ['photo'],
    });
  }
  return items;
}

export async function fetchHmvBooksRssCandidates() {
  try {
    const res = await fetch(HMV_BOOKS_RSS_URL, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const xml = new TextDecoder('shift_jis').decode(await res.arrayBuffer());
    return parseHmvRssXml(xml);
  } catch {
    return [];
  }
}

/* =========================================================
   4. B.L.T.web Official Editorial RSS
   ========================================================= */
export function parseBltWebRssXml(xml = '') {
  const items = [];
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  for (const m of blocks) {
    const body = m[1];
    const title = decodeHtmlEntities(
      ((body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim()
    );
    const url = ((body.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    if (!title || !url) continue;
    if (/【デジタル写真集】|デジタル写真集/.test(title)) continue;
    if (NOISE_OR_MALE_RE.test(title)) continue;
    items.push({
      title,
      url,
      issueKey: normalizeIssueKey(title),
    });
  }
  return items;
}

export async function fetchBltWebRssArticles() {
  try {
    const res = await fetch(BLTWEB_RSS_URL, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseBltWebRssXml(xml);
  } catch {
    return [];
  }
}
