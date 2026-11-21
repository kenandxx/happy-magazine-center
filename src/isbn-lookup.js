/**
 * Browser & Node ISBN / Amazon URL / Share-Sheet -> openBD Live Metadata Lookup (v1.0)
 *
 * Allows users to paste OR share ANY Japanese Amazon book URL (e.g. amazon.co.jp/dp/4299065921,
 * amzn.asia short links, iOS Shortcuts / Android PWA Share Target / Bookmarklet), ISBN-10, or
 * ISBN-13 and automatically fetch official publisher metadata directly from Japan's public
 * openBD API (CORS enabled: Access-Control-Allow-Origin: *, zero login).
 */

export const SHARE_BASE_URL = 'https://kenandxx.github.io/happy-magazine-center/?import=';

export const BOOKMARKLET_CODE =
  "javascript:(()=>{location.href='https://kenandxx.github.io/happy-magazine-center/?import='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)})();";

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
 * Converts a valid 13-digit 978-prefix ISBN-13 to 10-digit ISBN-10 (exact Amazon Japan book ASIN).
 */
export function isbn13To10(raw13) {
  const clean = String(raw13 || '').replace(/[^0-9]/g, '');
  if (clean.length !== 13 || !clean.startsWith('978')) return '';
  const core = clean.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(core[i]) * (10 - i);
  }
  const rem = (11 - (sum % 11)) % 11;
  return `${core}${rem === 10 ? 'X' : String(rem)}`;
}

/**
 * Extracts a safe https:// Amazon URL from arbitrary shared text (rejects non-Amazon / javascript: URLs).
 */
export function extractSafeAmazonUrl(rawText = '') {
  const m = String(rawText || '').match(
    /https:\/\/(?:www\.|m\.)?(?:amazon\.co\.jp|amzn\.asia|amzn\.to)\/[^\s"'<>）)\]]+/i
  );
  return m ? m[0] : '';
}

/**
 * Extracts a normalized 13-digit ISBN from an Amazon URL, multiline share text, ISBN-13, or ISBN-10 string.
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
      return { isbn13: digits, isbn10: isbn13To10(digits), sourceType: 'isbn13' };
    }
  }

  // 2. Amazon URL /dp/ASIN or /gp/product/ASIN or /product/ASIN (works even inside multiline share text!)
  const amzMatch = raw.match(/\/(?:dp|gp\/product|product|ASIN)\/([0-9]{9}[0-9Xx])(?:[/?#\s]|$)/i);
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

/**
 * Cleans an Amazon page title or Share Sheet text into a concise Japanese book title.
 */
export function cleanSharedAmazonTitle(rawText = '', rawTitle = '') {
  const candidate = String(rawTitle || rawText || '').trim();
  if (!candidate) return '';
  return candidate
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^Amazon\.co\.jp\s*[：:]\s*/i, '')
    .replace(/\s*[|｜]\s*.*?(?:Amazon|通販|本).*$/i, '')
    .replace(/\s*[：:]\s*本\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

/**
 * Parses incoming URL query parameters from:
 *   - iOS Shortcuts / Bookmarklet (`?import=...&title=...`)
 *   - Android PWA Web Share Target (`?title=...&text=...&url=...`)
 *   - Direct ISBN links (`?isbn=...`)
 *
 * Returns:
 *   - { mode: 'isbn', rawText, isbnInfo, cleanedTitle, safeAmazonUrl }
 *   - { mode: 'title_only', rawText, cleanedTitle, safeAmazonUrl }
 *   - { mode: 'empty' }
 */
export function parseIncomingSharePayload({
  importParam = '',
  urlParam = '',
  textParam = '',
  titleParam = '',
  isbnParam = '',
} = {}) {
  const parts = [importParam, isbnParam, urlParam, textParam, titleParam]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (!parts.length) return { mode: 'empty' };

  const combined = parts.join('\n');
  const safeAmazonUrl = extractSafeAmazonUrl(combined);
  const shortUrl = extractAmazonShortUrl(combined);
  const cleanedTitle = cleanSharedAmazonTitle(textParam || importParam, titleParam);
  const isbnInfo =
    extractIsbnFromInput(isbnParam) ||
    extractIsbnFromInput(importParam) ||
    extractIsbnFromInput(urlParam) ||
    extractIsbnFromInput(textParam);

  if (isbnInfo) {
    return {
      mode: 'isbn',
      rawText: safeAmazonUrl || importParam || urlParam || isbnInfo.isbn13,
      isbnInfo,
      cleanedTitle,
      safeAmazonUrl,
    };
  }

  if (shortUrl) {
    return {
      mode: 'short_url',
      rawText: shortUrl,
      shortUrl,
      cleanedTitle,
      safeAmazonUrl: safeAmazonUrl || shortUrl,
    };
  }

  if (cleanedTitle || safeAmazonUrl) {
    return {
      mode: 'title_only',
      rawText: combined,
      cleanedTitle: cleanedTitle || 'Amazon共有タイトル',
      safeAmazonUrl,
    };
  }

  return { mode: 'empty' };
}

/**
 * Extracts an Amazon app short link (https://amzn.asia/... or https://amzn.to/...).
 */
export function extractAmazonShortUrl(rawText = '') {
  const m = String(rawText || '').match(
    /https?:\/\/(?:www\.)?(?:amzn\.asia|amzn\.to)\/[A-Za-z0-9/_-]+/i
  );
  return m ? m[0].replace(/^http:/i, 'https:') : '';
}

/**
 * Expands an Amazon app short URL (`amzn.asia` / `amzn.to`) into its full `amazon.co.jp/dp/...`
 * destination directly from the browser using CORS-enabled public unshorten.me API (zero login).
 */
export async function expandAmazonShortUrl(shortUrl) {
  const cleanShort = extractAmazonShortUrl(shortUrl);
  if (!cleanShort) {
    return { ok: false, error: '有効な amzn.asia / amzn.to URL ではありません。' };
  }

  // Primary: JSON endpoint (Access-Control-Allow-Origin: *)
  try {
    const res = await fetch(`https://unshorten.me/json/${encodeURIComponent(cleanShort)}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const data = await res.json();
      const resolved = extractSafeAmazonUrl(data?.resolved_url || '');
      if (data?.success && resolved) {
        return { ok: true, resolvedUrl: resolved, shortUrl: cleanShort };
      }
    }
  } catch {
    // Fall through to plain-text endpoint
  }

  // Fallback: plain-text endpoint
  try {
    const res = await fetch(`https://unshorten.me/s/${cleanShort}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const txt = (await res.text()).trim();
      const resolved = extractSafeAmazonUrl(txt);
      if (resolved) {
        return { ok: true, resolvedUrl: resolved, shortUrl: cleanShort };
      }
    }
  } catch {
    // Non-fatal
  }

  return {
    ok: false,
    shortUrl: cleanShort,
    error: '短縮URLの自動展開がタイムアウトしました。Safariで一度開いて /dp/... のURLを貼るか、下のメモ欄から登録できます。',
  };
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

function extractTalentFromOpenBd(title, authorRaw) {
  // 1. Photobook / Calendar title often contains exact talent name right before "1st写真集" / "写真集" / "カレンダー"
  //    e.g. "ぴ〈ゅ〉あ : 尾崎由香1st写真集" -> "尾崎由香", "松井珠理奈写真集『アイヲシル』" -> "松井珠理奈"
  const normalizedTitle = String(title || '').normalize('NFKC');
  const titleTalentMatch = normalizedTitle.match(
    /(?:^|[:：／/\s『「【])([^\s:：／/『』「」【】()（）]{2,14}?)\s*(?:1st|2nd|3rd|4th|5th|ファースト|セカンド|サード|最新|待望の|メモリアル|卒業|202\d年)?\s*(?:写真集|フォトブック|フォトエッセイ|スタイルブック|カレンダー)/i
  );
  if (titleTalentMatch && titleTalentMatch[1]) {
    const candidate = titleTalentMatch[1].trim();
    if (candidate && !/^(豪華愛蔵版|完全|特別|限定|デジタル|ヘアヌード|ヌード)$/.test(candidate)) {
      return candidate;
    }
  }

  // 2. Clean openBD author ("長野,博文" -> "長野博文", "松井珠理奈／著" -> "松井珠理奈")
  const cleanedAuthor = String(authorRaw || '')
    .replace(/〔.*?〕|（.*?）|\(.*?\)/g, '')
    .replace(/([\u3040-\u30ff\u4e00-\u9faf]),\s*([\u3040-\u30ff\u4e00-\u9faf])/g, '$1$2')
    .trim();
  const firstAuthor = cleanedAuthor
    .split(/[、／/\s]+/)
    .map((part) => part.trim())
    .find((part) => part && !/^(著|写真|撮影|編集|監修)$/.test(part));

  if (firstAuthor) return firstAuthor;
  return String(title || '').split(/写真集|カレンダー|『|「|\s/)[0].trim() || '注目タレント';
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
  const talent = extractTalentFromOpenBd(title, s.author || '');

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
 * Automatically expands Amazon app short links (`https://amzn.asia/d/...` / `amzn.to/...`) first!
 */
export async function lookupBookByIsbnOrUrl(input, { onProgress } = {}) {
  let extracted = extractIsbnFromInput(input);
  let expandedFromShortUrl = '';
  let resolvedUrl = '';

  if (!extracted) {
    const shortUrl = extractAmazonShortUrl(input);
    if (shortUrl) {
      if (typeof onProgress === 'function') {
        onProgress('🔗 Amazonアプリの短縮URL（amzn.asia）を自動展開中...');
      }
      const expanded = await expandAmazonShortUrl(shortUrl);
      if (!expanded.ok) {
        return {
          ok: false,
          shortUrl,
          error: expanded.error,
        };
      }
      expandedFromShortUrl = shortUrl;
      resolvedUrl = expanded.resolvedUrl;
      extracted = extractIsbnFromInput(resolvedUrl);

      if (!extracted) {
        const bAsinMatch = resolvedUrl.match(/\/(?:dp|gp\/product)\/(B0[A-Z0-9]{8})(?:[/?#]|$)/i);
        if (bAsinMatch) {
          return {
            ok: false,
            shortUrl,
            resolvedUrl,
            nonBookAsin: bAsinMatch[1].toUpperCase(),
            error: `短縮URLを展開しました（ASIN: ${bAsinMatch[1].toUpperCase()}）が、Kindle電子版・雑誌コード・グッズ商品のためopenBD（紙書籍DB）に未登録です。Amazonで「単行本／大型本」に切り替えて共有するか、下のメモ欄からそのまま登録できます。`,
          };
        }
        return {
          ok: false,
          shortUrl,
          resolvedUrl,
          error: '短縮URLを展開しましたが、書籍のISBN/ASINを検出できませんでした。下のメモ欄から直接登録できます。',
        };
      }
    }
  }

  if (!extracted) {
    return {
      ok: false,
      error: 'Amazonアプリ共有URL（amzn.asia/d/...）、商品URL（/dp/4299065921 等）、またはISBN（10桁/13桁）を入力してください。',
    };
  }

  if (typeof onProgress === 'function') {
    onProgress(`🔍 ISBN ${extracted.isbn13} の公式書誌・書影を openBD から取得中...`);
  }

  try {
    const res = await fetch(
      `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(extracted.isbn13)}`
    );
    if (!res.ok) {
      return { ok: false, resolvedUrl, error: `openBD応答エラー (HTTP ${res.status})` };
    }
    const data = await res.json();
    const record = Array.isArray(data) ? data[0] : null;
    if (!record) {
      return {
        ok: false,
        isbn13: extracted.isbn13,
        resolvedUrl,
        error: `ISBN ${extracted.isbn13} はopenBDに未登録でした（雑誌コード・電子専用・予約解禁前の可能性があります）。下のフォームでそのまま手入力登録できます。`,
      };
    }
    const parsed = parseOpenBdRecord(record, extracted.isbn13);
    if (!parsed) {
      return { ok: false, isbn13: extracted.isbn13, resolvedUrl, error: '書誌データを解析できませんでした。' };
    }
    return {
      ok: true,
      book: parsed,
      extracted,
      ...(expandedFromShortUrl ? { expandedFromShortUrl, resolvedUrl } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      isbn13: extracted.isbn13,
      resolvedUrl,
      error: `ネットワーク取得に失敗しました（${err?.message || 'offline'}）`,
    };
  }
}
