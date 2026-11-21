/**
 * Normalize product titles across 7net, Rakuten Books, HMV, Amazon, and TSUTAYA
 * so multiple store-specific bonus editions of the same magazine issue or photobook
 * can be grouped into a single comparison card.
 */

const SERIES_ALIASES = [
  { pattern: /(?:^|\s)(?:utb|アップ\s*トゥ\s*ボーイ|アップトゥボーイ)(?:\s|$)/i, canonical: 'アップトゥボーイ' },
  { pattern: /b\.?l\.?t\.?(?:\s*関東版|\s*関西版)?/i, canonical: 'B.L.T.' },
  { pattern: /bomb(?:\s*\(ボム\))?/i, canonical: 'BOMB' },
  { pattern: /bubka(?:\s*\(ブブカ\))?/i, canonical: 'BUBKA' },
  { pattern: /週刊\s*プレイボーイ|週プレ/i, canonical: '週刊プレイボーイ' },
  { pattern: /週刊\s*少年\s*チャンピオン|少年チャンピオン/i, canonical: '週刊少年チャンピオン' },
  { pattern: /ビッグコミックスピリッツ/i, canonical: 'ビッグコミックスピリッツ' },
  { pattern: /ex大衆/i, canonical: 'EX大衆' },
  { pattern: /flash(?:\s*（フラッシュ）|\s*\(フラッシュ\))?/i, canonical: 'FLASH' },
  { pattern: /friday(?:\s*（フライデー）|\s*\(フライデー\))?/i, canonical: 'FRIDAY' },
  { pattern: /ヤングマガジン|ヤンマガ/i, canonical: 'ヤングマガジン' },
  { pattern: /ヤングジャンプ|ヤンジャン/i, canonical: 'ヤングジャンプ' },
  { pattern: /グラビアザテレビジョン/i, canonical: 'グラビアザテレビジョン' },
  { pattern: /blt\s*graph\.?/i, canonical: 'blt graph.' },
];

export function toHalfWidth(str = '') {
  return String(str)
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim();
}

export function stripStoreDecorations(rawTitle = '') {
  return toHalfWidth(rawTitle)
    .replace(/【[^】]*】/g, ' ')
    .replace(/《[^》]*》/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/「[^」]*限定表紙[^」]*」/g, ' ')
    .replace(/\([^)]*(?:特典|生写真|ブロマイド|ポストカード|ポスター|ステッカー|カード|絵柄)[^)]*\)/g, ' ')
    .replace(/(?:セブンネット|楽天ブックス|HMV|Loppi|Amazon|TSUTAYA)[^ ]*(?:限定版|限定表紙版?|カバー版?)/gi, ' ')
    .replace(/増刊|限定版/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBonusInfo(rawTitle = '', description = '') {
  const full = toHalfWidth(`${rawTitle} ${description}`);
  const types = new Set();

  if (/ポスター/.test(full)) types.add('poster');
  if (/ポストカード/.test(full)) types.add('postcard');
  if (/生写真|ブロマイド|チェキ/.test(full)) types.add('photo');
  if (/限定表紙|限定カバー|別表紙/.test(full)) types.add('cover');
  if (/dvd|メイキング映像/i.test(full)) types.add('dvd');
  if (/フォトカード|フォトグレイ|トレカ|ステッカー/.test(full)) types.add('card');
  if (/直筆サイン|サイン本/.test(full)) types.add('signed');

  if (types.size === 0) types.add('standard');

  // Extract bonus detail from common bracket patterns
  const bracketMatches = [...toHalfWidth(rawTitle).matchAll(/[【《]([^】》]+)[】》]/g)]
    .map((m) => m[1])
    .filter((txt) => /特典|限定|ポスター|ポストカード|生写真|表紙|サイン|DVD/i.test(txt));

  return {
    bonusTypes: [...types],
    hasSpecialBonus: ![...types].every((t) => t === 'standard'),
    bonusText: bracketMatches.join(' / ') || '通常版',
  };
}

export function normalizeIssueKey(rawTitle = '') {
  const cleaned = stripStoreDecorations(rawTitle);

  // Check magazine issue format (e.g., 2027年1月号, 2026年12月7日号, 2026年12/3号)
  const monthIssue = cleaned.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*号/);
  const dayIssue = cleaned.match(/(20\d{2})\s*年\s*(\d{1,2})\s*[月/]\s*(\d{1,2})\s*日?\s*号/);

  for (const { pattern, canonical } of SERIES_ALIASES) {
    if (pattern.test(cleaned)) {
      if (dayIssue) {
        return `${canonical}::${dayIssue[1]}-${dayIssue[2].padStart(2, '0')}-${dayIssue[3].padStart(2, '0')}`;
      }
      if (monthIssue) {
        return `${canonical}::${monthIssue[1]}-${monthIssue[2].padStart(2, '0')}`;
      }
    }
  }

  // Fallback for photobooks or other magazines: strip punctuation and whitespace
  return cleaned
    .toLowerCase()
    .replace(/[『』「」()（）・!?！？:\-]/g, '')
    .replace(/\s+/g, '');
}

export function groupStoreOffers(rawRecords = []) {
  const groups = new Map();

  for (const rec of rawRecords) {
    const key = normalizeIssueKey(rec.title);
    const parsed = parseBonusInfo(rec.title, rec.description);

    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        title: stripStoreDecorations(rec.title) || rec.title,
        releaseDate: rec.releaseDate || '',
        price: rec.price || 0,
        offers: [],
      });
    }

    const group = groups.get(key);
    if (!group.releaseDate && rec.releaseDate) group.releaseDate = rec.releaseDate;

    group.offers.push({
      store: rec.store,
      rawTitle: rec.title,
      bonusTypes: parsed.bonusTypes,
      hasSpecialBonus: parsed.hasSpecialBonus,
      hasStoreExclusiveBonus:
        rec.store !== 'amazon' &&
        (parsed.hasSpecialBonus &&
          /(?:限定特典|限定表紙|限定カバー|表紙違い|サイン本|抽選特典|オリジナル特典|ブロマイド|ポストカード|生写真)/.test(
            toHalfWidth(rec.title)
          )),
      bonusText: parsed.bonusText,
      price: rec.price || group.price,
      url: rec.url,
    });
  }

  return [...groups.values()];
}

/**
 * Policy filter:
 * - Always keep Amazon offers (primary base store for earning points).
 * - For non-Amazon stores (7net, Rakuten, HMV, TSUTAYA, etc.), keep ONLY offers
 *   that include a confirmed store-exclusive bonus so non-bonus links never add noise.
 */
export function filterOffersByPolicy(offers = []) {
  return offers.filter((offer) => {
    if (!offer) return false;
    if (offer.store === 'amazon') return true;
    return Boolean(offer.hasStoreExclusiveBonus);
  });
}
