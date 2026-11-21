/**
 * Multi-Publisher PR TIMES RSS Harvester & Precision Classifier (v0.9)
 *
 * Scans 15 major Japanese idol, gravure, photobook, calendar, and R18 publishers'
 * public PR TIMES RSS feeds (no login, no API key), filters out unrelated noise,
 * extracts verified release metadata & store-exclusive bonuses, and builds
 * policy-compliant catalog entries ready for automatic insertion.
 */

export const PRTIMES_PUBLISHER_FEEDS = [
  { publisher: '東京ニュース通信社', companyId: 6568 },
  { publisher: '宝島社', companyId: 5069 },
  { publisher: '講談社', companyId: 1719 },
  { publisher: 'KADOKAWA', companyId: 7006 },
  { publisher: '小学館', companyId: 13640 },
  { publisher: '光文社', companyId: 21468 },
  { publisher: '双葉社', companyId: 14531 },
  { publisher: '徳間書店', companyId: 16935 },
  { publisher: 'ワン・パブリッシング', companyId: 60318 },
  { publisher: '秋田書店', companyId: 40601 },
  { publisher: 'イマジカインフォス', companyId: 7785 },
  { publisher: '竹書房', companyId: 109856 },
  { publisher: 'ワニブックス', companyId: 129409 },
  { publisher: '集英社', companyId: 11454 },
  { publisher: '扶桑社', companyId: 26633 },
].map((entry) => ({
  ...entry,
  url: `https://prtimes.jp/companyrdf.php?company_id=${entry.companyId}`,
}));

const POSITIVE_SIGNAL_RE =
  /(写真集|グラビア|水着|ランジェリー|ビキニ|B\.L\.T\.|blt\s*graph|BLTISM|BLT\s*MONSTER|BOMB|ボム|BUBKA|BRODY|EX大衆|アップトゥボーイ|FLASH|Platinum\s*FLASH|FRIDAY|週プレ|週刊プレイボーイ|少年チャンピオン|ヤングチャンピオン|グラビアチャンピオン|ヤングマガジン|ヤングジャンプ|スピリッツ|SPA!|ENTAME|グラビアザテレビジョン|グラビアプレス|カレンダー|乃木坂46|櫻坂46|日向坂46|AKB48|SKE48|NMB48|HKT48|NGT48|STU48|FRUITS\s*ZIPPER|=LOVE|≠ME|僕が見たかった青空|CANDY\s*TUNE|ミスマガ|RIZINガール)/i;

const NEGATIVE_NOISE_RE =
  /(デジタル写真集|デジタル限定|電子写真集|電子書籍|電子版|俳優|男性|ボーイズ|メンズ|MEN'S|JO1|INI|timelesz|M!LK|FANTASTICS|BE:FIRST|SUPER\s*BEAVER|SixTONES|Snow\s*Man|なにわ男子|Travis\s*Japan|A\.B\.C-Z|SHOW-WA|MATSURI|WILD\s*BLUE|仮面ライダー|ウルトラマン|プロレス|野球|サッカー|競馬|将棋|占い|ダイエット|レシピ|カフェメニュー|フェルメール|皇室|パワースポット|ねことペンギン|児童|幼児|絵本|ゲーム攻略|コミック第?\d+巻|単行本\d+巻|スピンオフ|新連載|マンガ|漫画|セール|重版決定|写真展|お渡し会開催のみ|コスメアワード)/i;

/**
 * Determines whether a PR TIMES headline is a genuine physical idol/gravure/photobook/
 * calendar/magazine release worth inspecting.
 */
export function isTargetReleaseTitle(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (!POSITIVE_SIGNAL_RE.test(t)) return false;
  if (NEGATIVE_NOISE_RE.test(t)) return false;
  return true;
}

function pad2(n) {
  return String(Number(n)).padStart(2, '0');
}

function resolveReleaseDate(text, fallbackYear = 2026) {
  const fullPatterns = [
    /発売(?:予定)?日[：:\s]*(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日/,
    /(202[567])年\s*(\d{1,2})月\s*(\d{1,2})日[（(][月火水木金土日][）)]?\s*(?:に|より)?発売/,
  ];
  for (const re of fullPatterns) {
    const m = text.match(re);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  }

  const shortPatterns = [
    /発売(?:予定)?日[：:\s]*(\d{1,2})月\s*(\d{1,2})日/,
    /(\d{1,2})月\s*(\d{1,2})日[（(][月火水木金土日][）)]?\s*(?:に|より)?発売/,
  ];
  for (const re of shortPatterns) {
    const m = text.match(re);
    if (m) {
      const month = Number(m[1]);
      const year = month <= 3 && fallbackYear === 2026 ? 2027 : fallbackYear;
      return `${year}-${pad2(month)}-${pad2(m[2])}`;
    }
  }
  return '';
}

function extractStoreBonusesFromText(text) {
  const bonuses = [];
  const storeSpecs = [
    {
      store: '7net',
      name: 'セブンネット',
      re: /セブンネット(?:ショッピング)?[^。]{0,110}/i,
      urlRe: /https?:\/\/7net\.omni7\.jp\/[^\s"'<>）)]+/i,
    },
    {
      store: 'rakuten',
      name: '楽天ブックス',
      re: /楽天ブックス[^。]{0,110}/i,
      urlRe: /https?:\/\/books\.rakuten\.co\.jp\/rb\/\d+\/?/i,
    },
    {
      store: 'hmv',
      name: 'HMV&BOOKS',
      re: /HMV(?:&amp;|&)?BOOKS[^。]{0,110}/i,
      urlRe: /https?:\/\/(?:www\.)?hmv\.co\.jp\/[^\s"'<>）)]+/i,
    },
    {
      store: 'tsutaya',
      name: 'TSUTAYA',
      re: /TSUTAYA[^。]{0,110}/i,
      urlRe: /https?:\/\/(?:store\.tsite\.jp|tsutaya\.tsite\.jp|shibuyatsutaya\.tsite\.jp)\/[^\s"'<>）)]+/i,
    },
  ];

  const bonusSignalRe = /限定表紙|限定カバー|アザーカバー|生写真|ポストカード|ブロマイド|クリアファイル|ポスター|サイン本|特典|ラッキードロー/;

  for (const spec of storeSpecs) {
    const snippetMatch = text.match(spec.re);
    if (!snippetMatch) continue;
    const snippet = snippetMatch[0].replace(/&amp;/g, '&').trim();
    if (!bonusSignalRe.test(snippet)) continue;

    const urlMatch = snippet.match(spec.urlRe) || text.match(spec.urlRe);
    const bonusTypes = [];
    if (/限定表紙|限定カバー|アザーカバー/.test(snippet)) bonusTypes.push('cover');
    if (/サイン本|直筆サイン/.test(snippet)) bonusTypes.push('signed');
    if (/ポストカード/.test(snippet)) bonusTypes.push('postcard');
    if (/生写真|ブロマイド/.test(snippet)) bonusTypes.push('photo');
    if (/ポスター/.test(snippet)) bonusTypes.push('poster');
    if (!bonusTypes.length) bonusTypes.push('photo');

    bonuses.push({
      store: spec.store,
      storeName: spec.name,
      bonusTypes,
      snippet: snippet.slice(0, 90),
      url: urlMatch ? urlMatch[0] : '',
    });
  }

  return bonuses;
}

/**
 * Extracts structured release metadata from a public PR TIMES article HTML page.
 */
export function parsePrTimesArticleHtml(html, { title = '', publisher = '', url = '', pubDate = '' } = {}) {
  const ogImg = ((html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '')
    .replace(/&amp;/g, '&')
    .split('?')[0];

  const plainText = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isbnMatch = plainText.match(/978[-‐‑–—]?4[-‐‑–—]?\d{2,6}[-‐‑–—]?\d{2,6}[-‐‑–—]?\d/);
  const isbn = isbnMatch ? isbnMatch[0].replace(/[^0-9]/g, '') : '';

  const priceMatch =
    plainText.match(/(?:定価|価格)[：:\s]*([0-9,]{3,6})円/) ||
    plainText.match(/([0-9,]{3,6})円[（(]税込[）)]/);
  const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : 0;

  const fallbackYear = Number((pubDate || '2026').slice(0, 4)) || 2026;
  const releaseDate = resolveReleaseDate(plainText, fallbackYear) || (pubDate || '').slice(0, 10);

  // Clean book title from quotes 『...』 or 「...」 if present
  const quotedTitleMatch = title.match(/[『「]([^』」]{4,45})[』」]/);
  const cleanTitle = quotedTitleMatch ? quotedTitleMatch[1].trim() : title.slice(0, 56);

  const storeBonuses = extractStoreBonusesFromText(plainText);

  // Detect category
  let category = 'gravure';
  if (/ヘアヌード|オールヌード|豪華愛蔵版|彩文館|R18|アダルト/i.test(`${title} ${plainText.slice(0, 500)}`)) {
    category = 'r18';
  } else if (/カレンダー/.test(title)) {
    category = 'calendar';
  } else if (/写真集/.test(title)) {
    category = 'photobook';
  } else if (/B\.L\.T\.|BOMB|ボム|アップトゥボーイ|BUBKA|EX大衆|BRODY/i.test(title)) {
    category = 'idol';
  } else if (/チャンピオン|FLASH|FRIDAY|スピリッツ|週プレ|プレイボーイ|SPA!|近代麻雀/i.test(title)) {
    category = 'weekly';
  } else if (/CanCam|美的|non-no|ar|Ray|Sweet|bis/i.test(title)) {
    category = 'fashion';
  }

  return {
    title: cleanTitle,
    headline: title,
    publisher,
    url,
    releaseDate,
    price: price || (category === 'photobook' ? 3520 : category === 'calendar' ? 3300 : 1200),
    isbn,
    coverImageUrl: ogImg,
    storeBonuses,
    category,
  };
}
