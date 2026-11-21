/**
 * Live Multi-Store Stock & Review Checker for Hall-of-Fame Masterpieces (v1.2)
 *
 * Verifies live stock availability and public review stats across zero-login
 * Japanese bookstore pages (Rakuten Books, 7net, Maruzen Junkudo) so backlist
 * masterpieces (2024-01-01 to present) always show accurate new-stock vs
 * low-stock vs out-of-print/secondhand indicators.
 */

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function upgradeRakutenCoverUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.includes('thumbnail.image.rakuten.co.jp')) {
    return raw.replace(/_ex=\d+x\d+/i, '_ex=600x600');
  }
  return raw;
}

/**
 * Parses a public Rakuten Books product detail page (`https://books.rakuten.co.jp/rb/.../`).
 */
export function parseRakutenBookDetailHtml(html = '') {
  const raw = String(html || '');
  if (!raw) return null;

  const title = decodeHtmlEntities(
    ((raw.match(/<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i) ||
      raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      [])[1] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const isbn = (raw.match(/9784\d{9}/) || [])[0] || '';
  const price = Number((raw.match(/itemprop=["']price["'][^>]*content=["'](\d+)["']/i) || [])[1] || 0);
  const rating = Number(
    (raw.match(/itemprop=["']ratingValue["'][^>]*>\s*([0-9.]+)\s*</i) ||
      raw.match(/itemprop=["']ratingValue["'][^>]*content=["']([0-9.]+)["']/i) ||
      [])[1] || 0
  );
  const reviewCount = Number(
    (raw.match(/itemprop=["']reviewCount["'][^>]*>\s*(\d+)\s*</i) ||
      raw.match(/itemprop=["']reviewCount["'][^>]*content=["'](\d+)["']/i) ||
      [])[1] || 0
  );

  const statusRaw = decodeHtmlEntities(
    ((raw.match(/class=["'][^"']*status-text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      raw.match(/class=["'][^"']*new_itemStock[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      [])[1] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  let statusText = statusRaw;
  if (!statusText) {
    const fallback = raw.match(/(ご注文できない商品|在庫あり|在庫わずか|残りわずか|メーカー取り寄せ|予約受付中|品切れ)/);
    if (fallback) statusText = fallback[1];
  }

  const ogImg = ((raw.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '').trim();
  const pubMatch = raw.match(/発売日[\s\S]{0,160}?(202[4567])年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const releaseDate = pubMatch ? `${pubMatch[1]}-${pad2(pubMatch[2])}-${pad2(pubMatch[3])}` : '';

  return {
    title,
    isbn,
    price,
    rating: Number.isFinite(rating) ? Math.round(rating * 100) / 100 : 0,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : 0,
    statusText,
    coverImageUrl: upgradeRakutenCoverUrl(ogImg),
    releaseDate,
  };
}

/**
 * Parses Schema.org Product availability from a 7net product detail page.
 */
export function parseSevenNetProductAvailability(html = '') {
  const raw = String(html || '');
  const ldBlocks = [
    ...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const m of ldBlocks) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && parsed['@type'] === 'Product') {
        const offer = Array.isArray(parsed.offers) ? parsed.offers[0] : parsed.offers;
        const availUrl = String(offer?.availability || '');
        const availToken = availUrl.split('/').pop() || '';
        return {
          availability: availToken, // InStock | OutOfStock | LimitedAvailability | PreOrder
          price: Math.round(Number(offer?.price) || 0),
        };
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }
  return null;
}

/**
 * Parses Maruzen Junkudo product page availability (`"available":true` / `false`).
 */
export function parseMaruzenAvailability(html = '') {
  const raw = String(html || '');
  if (!raw) return null;
  if (/"available"\s*:\s*true/i.test(raw)) return true;
  if (/"available"\s*:\s*false/i.test(raw)) return false;
  return null;
}

function classifyRakutenStatus(statusText = '') {
  const s = String(statusText || '').trim();
  if (!s) return 'unknown';
  if (/ご注文できない商品|品切れ|在庫切れ|販売終了|絶版|注文不可/.test(s)) return 'out';
  if (/在庫わずか|残りわずか|取り寄せ|入荷予約|メーカー/.test(s)) return 'low';
  if (/在庫あり|予約受付中|通常/.test(s)) return 'in';
  return 'unknown';
}

function classifySevenNetStatus(avail = '') {
  const s = String(avail || '').trim();
  if (!s) return 'unknown';
  if (/OutOfStock|SoldOut|Discontinued/i.test(s)) return 'out';
  if (/LimitedAvailability/i.test(s)) return 'low';
  if (/InStock|PreOrder/i.test(s)) return 'in';
  return 'unknown';
}

/**
 * Combines live store checks into a single transparent stock status object.
 */
export function computeUnifiedStockStatus({
  rakutenStatus = '',
  sevenNetStatus = '',
  maruzenAvailable = null,
  checkedAt = '2026-11-21',
} = {}) {
  const rClass = classifyRakutenStatus(rakutenStatus);
  const sClass = classifySevenNetStatus(sevenNetStatus);
  const mClass = maruzenAvailable === true ? 'in' : maruzenAvailable === false ? 'out' : 'unknown';

  const parts = [];
  if (rakutenStatus) parts.push(`楽天ブックス: ${rakutenStatus}`);
  if (sevenNetStatus) {
    const sJa =
      sClass === 'in'
        ? '在庫あり'
        : sClass === 'low'
          ? '残りわずか'
          : sClass === 'out'
            ? '品切れ'
            : sevenNetStatus;
    parts.push(`7net: ${sJa}`);
  }
  if (maruzenAvailable === true) parts.push('丸善ジュンク堂: 在庫あり');
  else if (maruzenAvailable === false) parts.push('丸善ジュンク堂: 品切れ');

  const classes = [rClass, sClass, mClass].filter((c) => c !== 'unknown');
  const inCount = classes.filter((c) => c === 'in').length;
  const lowCount = classes.filter((c) => c === 'low').length;
  const outCount = classes.filter((c) => c === 'out').length;

  let status = 'in_stock';
  let label = '✅ 新品在庫あり';

  if (inCount >= 2) {
    status = 'in_stock';
    label = '✅ 新品在庫あり';
  } else if (inCount === 1 && outCount >= 1) {
    status = 'low_stock';
    label = '⚠️ 品薄・一部ストアのみ';
  } else if (inCount === 1) {
    status = 'in_stock';
    label = '✅ 新品在庫あり';
  } else if (lowCount >= 1) {
    status = 'low_stock';
    label = '⚠️ 残りわずか・取り寄せ';
  } else if (outCount >= 1) {
    status = 'out_of_stock';
    label = '🔴 新品完売・中古/プレミア';
  } else {
    status = 'low_stock';
    label = '⚠️ 在庫要確認（流通少）';
  }

  return {
    status,
    label,
    detail: parts.join(' ／ ') || '主要書店で最新在庫を確認してください',
    checkedAt,
    ...(rakutenStatus ? { rakutenStatus } : {}),
    ...(sevenNetStatus ? { sevenNetStatus } : {}),
    ...(maruzenAvailable !== null ? { maruzenAvailable } : {}),
  };
}

/**
 * Refreshes live stock & review metadata for a list of masterpiece items.
 */
export async function refreshMasterpiecesLiveStatus(masterpieces = [], { dateStr = '2026-11-21' } = {}) {
  let updatedCount = 0;
  let rakutenConsecutiveFailures = 0;
  let rakutenBackedOff = false;

  for (const item of masterpieces) {
    let rakutenStatus = item.stockInfo?.rakutenStatus || '';
    let sevenNetStatus = item.stockInfo?.sevenNetStatus || '';
    let maruzenAvailable =
      typeof item.stockInfo?.maruzenAvailable === 'boolean' ? item.stockInfo.maruzenAvailable : null;

    // 1. Rakuten Books live detail check (stock + rating + reviewCount) with polite rate-limit backoff
    if (item.rakutenUrl && !rakutenBackedOff) {
      try {
        const res = await fetch(item.rakutenUrl, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(9000),
        });
        if (res.ok) {
          rakutenConsecutiveFailures = 0;
          const html = await res.text();
          const parsed = parseRakutenBookDetailHtml(html);
          if (parsed) {
            if (parsed.statusText) rakutenStatus = parsed.statusText;
            if (parsed.reviewCount > 0 && parsed.rating > 0) {
              item.reviewStats = {
                source: 'rakuten',
                rating: parsed.rating,
                reviewCount: parsed.reviewCount,
              };
            }
          }
        } else {
          rakutenConsecutiveFailures += 1;
        }
      } catch {
        rakutenConsecutiveFailures += 1;
      }
      if (rakutenConsecutiveFailures >= 2) {
        rakutenBackedOff = true;
      }
      await sleep(160);
    }

    // 2. 7net live detail check (if direct 7net detail URL recorded)
    if (item.sevenNetUrl) {
      try {
        const res = await fetch(item.sevenNetUrl, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(9000),
        });
        if (res.ok) {
          const html = await res.text();
          const parsed = parseSevenNetProductAvailability(html);
          if (parsed?.availability) sevenNetStatus = parsed.availability;
        }
      } catch {
        // Non-fatal
      }
      await sleep(110);
    }

    // 3. Maruzen Junkudo live ISBN check (fast Shopify product page)
    if (item.isbn && /^9784\d{9}$/.test(item.isbn)) {
      try {
        const res = await fetch(`https://www.maruzenjunkudo.co.jp/products/${item.isbn}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const html = await res.text();
          const avail = parseMaruzenAvailability(html);
          if (avail !== null) maruzenAvailable = avail;
        } else if (res.status === 404) {
          maruzenAvailable = false;
        }
      } catch {
        // Non-fatal
      }
      await sleep(90);
    }

    item.stockInfo = computeUnifiedStockStatus({
      rakutenStatus,
      sevenNetStatus,
      maruzenAvailable,
      checkedAt: dateStr,
    });
    if (item.acclaimBadge) {
      item.printOnlyNote = `${item.acclaimBadge}。${item.stockInfo.label}（${item.stockInfo.detail}）`;
    }
    updatedCount += 1;
  }

  return { updatedCount, rakutenBackedOff };
}
