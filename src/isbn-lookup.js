/**
 * Browser & Node ISBN / Amazon URL -> openBD Live Metadata Lookup (v0.9)
 *
 * Allows users to paste ANY Japanese Amazon book URL (e.g. amazon.co.jp/dp/4299065926),
 * ISBN-10, or ISBN-13 and automatically fetch official publisher metadata directly from
 * Japan's public openBD API (CORS enabled: Access-Control-Allow-Origin: *, zero login).
 */

/**
 * Converts a valid 10-digit Japanese ISBN-10 / Amazon book ASIN to ISBN-13.
 */
export function isbn10To13(raw10) {
  const clean = String(raw10 || '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
  if (!/^[0-9]{9}[0-9X]$/.test(clean)) return '';
  const body = `978${clean.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

/**
 * Extracts a normalized 13-digit ISBN from an Amazon URL, ISBN-13, or ISBN-10 string.
 * Returns { isbn13, isbn10, sourceType } or null if no valid ISBN is detected.
 */
export function extractIsbnFromInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // 1. Direct ISBN-13 anywhere in text/URL (e.g. 978-4-299-06592-6 or 9784299065926)
  const m13 = raw.match(/97[89][-\s]?[0-9][-\s0-9]{8,14}[0-9]/);
  if (m13) {
    const digits = m13[0].replace(/[^0-9]/g, '');
    if (digits.length === 13) {
      return { isbn13: digits, isbn10: '', sourceType: 'isbn13' };
    }
  }

  // 2. Amazon URL /dp/ASIN or /gp/product/ASIN or /product/ASIN
  const amzMatch = raw.match(/\/(?:dp|gp\/product|product|ASIN)\/([0-9]{9}[0-9Xx])(?:[/?#]|$)/i);
  if (amzMatch) {
    const isbn10 = amzMatch[1].toUpperCase();
    const isbn13 = isbn10To13(isbn10);
    if (isbn13) {
      return { isbn13, isbn10, sourceType: 'amazon_url' };
    }
  }

  // 3. Raw ISBN-10 (often Japanese books start with 4)
  const clean10 = raw.toUpperCase().replace(/[^0-9X]/g, '');
  if (/^[0-9]{9}[0-9X]$/.test(clean10)) {
    const isbn13 = isbn10To13(clean10);
    if (isbn13) {
      return { isbn13, isbn10: clean10, sourceType: 'isbn10' };
    }
  }

  return null;
}

function normalizePubDate(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (digits.length === 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-01`;
  }
  return '';
}

function detectCategoryFromMetadata(title, publisher, description) {
  const text = `${title} ${publisher} ${description}`;
  if (/ヘアヌード|オールヌード|ヌード写真集|ヌードポーズ|豪華愛蔵版|FANZA|彩文館|ジーウォーク|ジーオーティー|R18|アダルト/i.test(text)) {
    return 'r18';
  }
  if (/カレンダー/.test(title)) return 'calendar';
  if (/写真集|フォトブック|フォトエッセイ|STYLE BOOK/i.test(text)) return 'photobook';
  if (/B\.L\.T\.|BOMB|アップトゥボーイ|BUBKA|EX大衆|BRODY/i.test(title)) return 'idol';
  if (/プレイボーイ|FLASH|FRIDAY|SPA!|チャンピオン|スピリッツ|ヤングマガジン|ヤングジャンプ/i.test(title)) {
    return 'weekly';
  }
  return 'gravure';
}

/**
 * Parses an openBD record into a normalized preview object for Happy Magazine Center.
 */
export function parseOpenBdRecord(record, fallbackIsbn13 = '') {
  if (!record || typeof record !== 'object') return null;
  const s = record.summary || {};
  const isbn = s.isbn || fallbackIsbn13;
  const title = String(s.title || '').trim();
  if (!title) return null;

  const publisher =
    String(
      s.publisher ||
        record.onix?.PublishingDetail?.Imprint?.ImprintName ||
        record.onix?.PublishingDetail?.Publisher?.PublisherName ||
        ''
    ).trim() || '出版社公式';
  const authorRaw = String(s.author || '').trim();
  const talent =
    authorRaw
      .split(/[,、／/\s]+/)
      .map((part) => part.replace(/〔.*?〕|（.*?）|\(.*?\)/g, '').trim())
      .filter((part) => part && !/^(著|写真|撮影|編集|監修)$/.test(part))[0] ||
    title.split(/写真集|カレンダー|『|「|\s/)[0].trim() ||
    '注目タレント';

  const onixDates = record.onix?.PublishingDetail?.PublishingDate || [];
  const rawDate =
    s.pubdate ||
    (Array.isArray(onixDates) && onixDates[0]?.Date) ||
    record.hanmoto?.dateshuppan ||
    '';
  const releaseDate = normalizePubDate(rawDate);

  const rawPrice = Number(record.onix?.ProductSupply?.SupplyDetail?.Price?.[0]?.PriceAmount) || 0;
  // Japanese openBD ONIX PriceAmount is usually tax-excluded body price -> convert to 10% tax-included
  const price = rawPrice > 0 ? Math.round(rawPrice * 1.1) : 3300;

  const textContents = record.onix?.CollateralDetail?.TextContent || [];
  const description =
    (Array.isArray(textContents) && textContents.find((t) => t?.Text)?.Text) || '';

  const category = detectCategoryFromMetadata(title, publisher, description);
  const coverImageUrl = s.cover || (isbn ? `https://img.hanmoto.com/bd/img/${isbn}.jpg` : '');

  return {
    isbn,
    title,
    talent,
    publisher,
    releaseDate,
    price,
    category,
    description: String(description).replace(/\s+/g, ' ').trim().slice(0, 180),
    coverImageUrl,
  };
}

/**
 * Live lookup against Japan's public openBD API (CORS enabled, no login).
 */
export async function lookupBookByIsbnOrUrl(input) {
  const extracted = extractIsbnFromInput(input);
  if (!extracted) {
    return {
      ok: false,
      error: 'Amazonの商品URL（/dp/4299065926 等）またはISBN（10桁/13桁）を入力してください。',
    };
  }

  try {
    const res = await fetch(
      `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(extracted.isbn13)}`
    );
    if (!res.ok) {
      return { ok: false, error: `openBD応答エラー (HTTP ${res.status})` };
    }
    const data = await res.json();
    const record = Array.isArray(data) ? data[0] : null;
    if (!record) {
      return {
        ok: false,
        isbn13: extracted.isbn13,
        error: `ISBN ${extracted.isbn13} はopenBDに未登録でした（雑誌コード・電子専用・予約解禁前の可能性があります）。下のフォームでそのまま手入力登録できます。`,
      };
    }
    const parsed = parseOpenBdRecord(record, extracted.isbn13);
    if (!parsed) {
      return { ok: false, isbn13: extracted.isbn13, error: '書誌データを解析できませんでした。' };
    }
    return { ok: true, book: parsed, extracted };
  } catch (err) {
    return {
      ok: false,
      isbn13: extracted.isbn13,
      error: `ネットワーク取得に失敗しました（${err?.message || 'offline'}）`,
    };
  }
}
