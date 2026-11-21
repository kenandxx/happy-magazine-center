/**
 * Scarcity & Early Pre-Order Priority Scoring Engine (v0.9)
 *
 * Evaluates catalog titles within the active 2-3 month window (-14 to +100 days)
 * using transparent, rule-based factors plus user-customizable VIP S-Rank talents
 * and configurable Oshi keyword boost strength.
 */

export const URGENT_WINDOW_MIN_DAYS = -14;
export const URGENT_WINDOW_MAX_DAYS = 100;

export const OSHI_BOOST_PRESETS = {
  standard: {
    id: 'standard',
    label: '標準 (+14)',
    shortLabel: '標準 +14pt',
    points: 14,
    genericPoints: 6,
    desc: '通常バランス（推しワードに +14pt）',
  },
  strong: {
    id: 'strong',
    label: '強め・推奨 (+24)',
    shortLabel: '強め +24pt',
    points: 24,
    genericPoints: 10,
    desc: '推しの新刊を優先ハイライト（+24pt）',
  },
  max: {
    id: 'max',
    label: '推し最優先 (+34)',
    shortLabel: '最優先 +34pt',
    points: 34,
    genericPoints: 14,
    desc: '推しの新刊・特典を最上位S〜Aへ押し上げ（+34pt）',
  },
};

export const POPULAR_TALENT_PRESETS = [
  // === 🎤 アイドル・グループ ===
  { name: '乃木坂46', group: 'idol', tag: '超人気' },
  { name: '櫻坂46', group: 'idol', tag: '超人気' },
  { name: '日向坂46', group: 'idol', tag: '超人気' },
  { name: 'AKB48', group: 'idol', tag: '超人気' },
  { name: '川﨑桜', group: 'idol', tag: '乃木坂46' },
  { name: '瀬戸口心月', group: 'idol', tag: '乃木坂46' },
  { name: '五百城茉央', group: 'idol', tag: '乃木坂46' },
  { name: '遠藤さくら', group: 'idol', tag: '乃木坂46' },
  { name: '賀喜遥香', group: 'idol', tag: '乃木坂46' },
  { name: '井上和', group: 'idol', tag: '乃木坂46' },
  { name: '池田瑛紗', group: 'idol', tag: '乃木坂46' },
  { name: '一ノ瀬美空', group: 'idol', tag: '乃木坂46' },
  { name: '小川彩', group: 'idol', tag: '乃木坂46' },
  { name: '小坂菜緒', group: 'idol', tag: '日向坂46' },
  { name: '正源司陽子', group: 'idol', tag: '日向坂46' },
  { name: '小栗有以', group: 'idol', tag: 'AKB48' },
  { name: '佐藤綺星', group: 'idol', tag: 'AKB48' },
  { name: '平田侑希', group: 'idol', tag: 'AKB48' },
  { name: '松井珠理奈', group: 'idol', tag: '写真集' },
  { name: '兒玉遥', group: 'idol', tag: '写真集' },
  { name: '出口夏希', group: 'idol', tag: '女優・モデル' },
  { name: '芳根京子', group: 'idol', tag: '女優・カレンダー' },
  { name: '長濱ねる', group: 'idol', tag: 'タレント' },
  { name: '与田祐希', group: 'idol', tag: 'タレント' },
  { name: '金澤亜美', group: 'idol', tag: '僕青' },
  { name: '僕が見たかった青空', group: 'idol', tag: 'グループ' },
  { name: 'FRUITS ZIPPER', group: 'idol', tag: 'グループ' },
  { name: 'CANDY TUNE', group: 'idol', tag: 'グループ' },

  // === 👙 グラビア・コスプレ ===
  { name: 'えなこ', group: 'gravure', tag: '超人気' },
  { name: '沢口愛華', group: 'gravure', tag: '超人気' },
  { name: '東雲うみ', group: 'gravure', tag: '超人気' },
  { name: '伊織もえ', group: 'gravure', tag: '超人気' },
  { name: '田中美久', group: 'gravure', tag: '超人気' },
  { name: '桃月なしこ', group: 'gravure', tag: '超人気' },
  { name: '高崎かなみ', group: 'gravure', tag: '3rd写真集' },
  { name: '溝端葵', group: 'gravure', tag: '注目' },
  { name: '白濱美兎', group: 'gravure', tag: '注目' },
  { name: '一ノ瀬瑠菜', group: 'gravure', tag: '注目' },
  { name: '山田あい', group: 'gravure', tag: '注目' },
  { name: '榎原依那', group: 'gravure', tag: '注目' },
  { name: '澄田綾乃', group: 'gravure', tag: '注目' },
  { name: '本郷柚巴', group: 'gravure', tag: '注目' },
  { name: '菊地姫奈', group: 'gravure', tag: '注目' },
  { name: '豊島心桜', group: 'gravure', tag: '注目' },
  { name: '新田妃奈', group: 'gravure', tag: '1st写真集' },
  { name: '五百木いお', group: 'gravure', tag: '1st写真集' },
  { name: '井口裕香', group: 'gravure', tag: '声優グラビア' },
  { name: '姫野ひなの', group: 'gravure', tag: '注目' },
  { name: 'ちとせよしの', group: 'gravure', tag: '注目' },
  { name: '豊田ルナ', group: 'gravure', tag: '注目' },
  { name: '田中有紀', group: 'gravure', tag: 'サイン本' },
  { name: '古賀瑠', group: 'gravure', tag: 'サイン本' },

  // === 🔞 R18 人気女優 ===
  { name: '瀬戸環奈', group: 'r18', tag: '超人気' },
  { name: '石川澪', group: 'r18', tag: '超人気' },
  { name: '河北彩伽', group: 'r18', tag: '超人気' },
  { name: '三上悠亜', group: 'r18', tag: '超人気' },
  { name: '小野六花', group: 'r18', tag: '3000部限定' },
  { name: '伊藤舞雪', group: 'r18', tag: '超人気' },
  { name: '宮下玲奈', group: 'r18', tag: '超人気' },
  { name: '藤森里穂', group: 'r18', tag: '人気' },
  { name: '金松季歩', group: 'r18', tag: '人気' },
  { name: '園梨音', group: 'r18', tag: '大型新人' },
  { name: '初美なのか', group: 'r18', tag: '3000部限定' },
  { name: '三澄寧々', group: 'r18', tag: '人気' },
  { name: '小島みなみ', group: 'r18', tag: '15周年' },
  { name: '瀧本雫葉', group: 'r18', tag: 'カレンダー' },
  { name: '長浜みつり', group: 'r18', tag: 'カレンダー' },
  { name: '波多野結衣', group: 'r18', tag: 'レジェンド' },
  { name: '弥生みづき', group: 'r18', tag: '人気' },
  { name: '木下凛々子', group: 'r18', tag: '12月新刊' },
  { name: '川上ゆう', group: 'r18', tag: '20周年' },
  { name: '吉根ゆりあ', group: 'r18', tag: '12月新刊' },
  { name: '糸井瑠花', group: 'r18', tag: '1st写真集' },
  { name: '木村愛心', group: 'r18', tag: '3000部限定' },
  { name: '井上もも', group: 'r18', tag: 'ポーズ集' },
  { name: '八掛うみ', group: 'r18', tag: 'カレンダー' },
  { name: '森日向子', group: 'r18', tag: 'カレンダー' },

  // === 🎁 定番特典・注目ワード ===
  { name: '限定表紙', group: 'bonus', tag: '特典' },
  { name: 'サイン本', group: 'bonus', tag: '即完' },
  { name: 'ポスター', group: 'bonus', tag: '付録' },
  { name: '豪華愛蔵版', group: 'bonus', tag: '部数限定' },
  { name: 'カレンダー', group: 'bonus', tag: '2027年' },
];

export const TIER1_POPULAR_TALENTS = [
  '乃木坂46',
  '櫻坂46',
  '日向坂46',
  'AKB48',
  '川﨑桜',
  '瀬戸口心月',
  '五百城茉央',
  '賀喜遥香',
  '遠藤さくら',
  '池田瑛紗',
  '一ノ瀬美空',
  '井上和',
  '小坂菜緒',
  '正源司陽子',
  '与田祐希',
  '小栗有以',
  '佐藤綺星',
  '松井珠理奈',
  '桃月なしこ',
  '芳根京子',
  'えなこ',
  '沢口愛華',
  '東雲うみ',
  '伊織もえ',
  '出口夏希',
  '長濱ねる',
  '田中美久',
  '榎原依那',
  '溝端葵',
  '白濱美兎',
  '一ノ瀬瑠菜',
  '山田あい',
  '瀬戸環奈',
  '石川澪',
  '河北彩伽',
  '河北彩花',
  '三上悠亜',
  '小野六花',
  '伊藤舞雪',
  '宮下玲奈',
  '藤森里穂',
  '金松季歩',
  '園梨音',
  '初美なのか',
  '小島みなみ',
];

export const TIER2_POPULAR_TALENTS = [
  '兒玉遥',
  '高崎かなみ',
  'ちとせよしの',
  '本郷柚巴',
  '菊地姫奈',
  '豊島心桜',
  '澄田綾乃',
  '雪平莉左',
  '金澤亜美',
  '僕が見たかった青空',
  'FRUITS ZIPPER',
  'CANDY TUNE',
  '=LOVE',
  '≠ME',
  '平田侑希',
  '井口裕香',
  '姫野ひなの',
  '三澄寧々',
  '瀧本雫葉',
  '長浜みつり',
  '弥生みづき',
  '川上ゆう',
  '木下凛々子',
  '木村愛心',
  '波多野結衣',
  '糸井瑠花',
  '吉根ゆりあ',
  '井上もも',
  '八掛うみ',
  '森日向子',
  '三好佑香',
  '虹村ゆみ',
];

const GENERIC_OSHI_KEYWORDS = new Set([
  'ポスター',
  'ポストカード',
  '生写真',
  'ブロマイド',
  'カレンダー',
  '写真集',
  '限定表紙',
  'サイン本',
  '豪華愛蔵版',
  'DVD',
]);

export const SCARCITY_RANK_META = {
  S: {
    rank: 'S',
    badge: '🔴 Sランク・即予約推奨',
    shortBadge: '🔴 S・即予約',
    desc: '限定部数・サイン本・限定表紙・超人気VIP等の争奪要因が重複。迷う前に即確保推奨！',
    colorClass: 'rank-s',
  },
  A: {
    rank: 'A',
    badge: '🟠 Aランク・早め確保',
    shortBadge: '🟠 A・早め確保',
    desc: '人気特典や発売間近・初回生産枠のため、発売日前に予約しておくと安心。',
    colorClass: 'rank-a',
  },
  B: {
    rank: 'B',
    badge: '🟡 Bランク・注目枠',
    shortBadge: '🟡 B・注目',
    desc: '今後2〜3ヶ月の注目新刊・解禁待ち枠。絵柄公開や在庫動向をウォッチ推奨。',
    colorClass: 'rank-b',
  },
  C: {
    rank: 'C',
    badge: '⚪ 通常在庫枠',
    shortBadge: '⚪ 通常',
    desc: '通常流通枠。',
    colorClass: 'rank-c',
  },
};

function calcDiffDays(dateStr, refDateStr) {
  if (!dateStr || !refDateStr) return 999;
  const target = new Date(`${dateStr}T00:00:00`);
  const ref = new Date(`${refDateStr}T00:00:00`);
  return Math.round((target - ref) / (1000 * 60 * 60 * 24));
}

function getVisiblePolicyOffers(item) {
  return (item?.offers || []).filter((offer) => {
    if (offer.store === 'amazon') return true;
    return offer.hasStoreExclusiveBonus === true;
  });
}

function buildSearchHaystack(item, visibleOffers) {
  return [
    item.title,
    item.series,
    item.publisher,
    item.summary,
    item.printOnlyNote,
    ...(item.coverTalents || []),
    ...(item.featuredTalents || []),
    ...(item.includedBonuses || []).map((b) => b.label),
    ...visibleOffers.map((o) => `${o.edition || ''} ${o.bonusText || ''} ${o.talent || ''}`),
  ]
    .filter(Boolean)
    .join(' ');
}

function scoreOfferScarcity(offer) {
  let pts = 0;
  const types = offer.bonusTypes || [];
  const text = `${offer.edition || ''} ${offer.bonusText || ''}`;
  if (types.includes('signed') || /サイン本|直筆サイン/.test(text)) pts += 100;
  if (types.includes('cover') || /限定表紙|別カバー/.test(text)) pts += 70;
  if (/3000部限定|4000部限定|\d+部限定|豪華愛蔵版|数量限定/.test(text)) pts += 60;
  if (offer.hasStoreExclusiveBonus === true) pts += 40;
  if (offer.artworkStatus === 'revealed' && offer.imageUrl) pts += 10;
  if (offer.store === '7net') pts += 5;
  if (offer.store === 'amazon') pts += 1;
  return pts;
}

/**
 * Computes a transparent 0-100 sell-out scarcity score for a catalog item.
 *
 * @param {object} item - Catalog item
 * @param {object} options
 * @param {string} [options.referenceDate='2026-11-21'] - YYYY-MM-DD
 * @param {string[]} [options.oshiKeywords=[]] - User's registered oshi keywords
 * @param {string[]} [options.vipTalents=[]] - User's custom S-Rank VIP talents (+30pt)
 * @param {'standard'|'strong'|'max'} [options.oshiBoostMode='strong'] - Oshi boost strength
 */
export function calculateScarcityScore(
  item,
  {
    referenceDate = '2026-11-21',
    oshiKeywords = [],
    vipTalents = [],
    oshiBoostMode = 'strong',
  } = {}
) {
  const boostPreset = OSHI_BOOST_PRESETS[oshiBoostMode] || OSHI_BOOST_PRESETS.strong;
  const visibleOffers = getVisiblePolicyOffers(item);
  const exclusiveOffers = visibleOffers.filter((o) => o.hasStoreExclusiveBonus === true);
  const days = calcDiffDays(item.releaseDate, referenceDate);
  const inWindow = days >= URGENT_WINDOW_MIN_DAYS && days <= URGENT_WINDOW_MAX_DAYS;
  const isForecastOnly =
    Boolean(item.id && item.id.endsWith('-forecast')) ||
    (visibleOffers.length > 0 && visibleOffers.every((o) => o.status === 'forecast'));

  const haystack = buildSearchHaystack(item, visibleOffers);
  const haystackLower = haystack.toLowerCase();
  const reasons = [];
  let rawScore = 0;

  const addReason = (key, icon, label, points, tone = 'neutral') => {
    rawScore += points;
    reasons.push({ key, icon, label, points, tone });
  };

  // 1. Limited Print Runs / Retail Signed Editions / Explicit Scarcity
  const retailOfferText = [
    item.title,
    ...visibleOffers.map((o) => `${o.edition || ''} ${o.bonusText || ''}`),
  ]
    .filter(Boolean)
    .join(' ');
  const hasRetailSigned =
    visibleOffers.some((o) => (o.bonusTypes || []).includes('signed')) ||
    /サイン本|直筆サイン本/.test(retailOfferText);
  const exactRunMatch = haystack.match(/(\d{3,4}部限定)/);
  const hasLuxuryEdition = /豪華愛蔵版/.test(haystack);
  const hasQtyLimited = /数量限定|なくなり次第|先着|限定生産|初回限定|初回封入|抽選/.test(
    haystack
  );
  const hasLaunchEvent = /発売記念イベント|お渡し会|イベント開催/.test(haystack);

  if (hasRetailSigned) {
    addReason('signed', '✒️', '直筆サイン本・即完警戒', 36, 'critical');
  } else if (exactRunMatch) {
    addReason(
      'limited_run',
      '💎',
      `${exactRunMatch[1]}${hasLuxuryEdition ? '（豪華愛蔵版）' : ''}`,
      35,
      'critical'
    );
  } else if (hasLuxuryEdition) {
    addReason('limited_run', '💎', '豪華愛蔵版（限定生産）', 30, 'critical');
  } else if (hasQtyLimited) {
    addReason('qty_limited', '⚡', '数量限定・初回枠あり', 20, 'high');
  } else if (hasLaunchEvent) {
    addReason('launch_event', '🎟', '発売イベント開催・注目作', 12, 'medium');
  }

  // 2. Store-Exclusive Cover / DVD / Giant Poster
  const hasExclusiveCover =
    visibleOffers.some((o) => (o.bonusTypes || []).includes('cover')) ||
    /限定表紙|別カバー/.test(haystack);
  const hasDvdOrBigPoster =
    visibleOffers.some((o) => (o.bonusTypes || []).includes('dvd')) ||
    (item.includedBonuses || []).some((b) => b.type === 'dvd' || b.type === 'poster') ||
    /特大両面ポスター|両面ポスター|B2ポスター|DVD/.test(haystack);

  if (hasExclusiveCover) {
    addReason('exclusive_cover', '✨', 'ストア限定表紙（再販なし）', 24, 'critical');
  } else if (hasDvdOrBigPoster) {
    addReason('dvd_poster', '🎁', 'ポスター・DVD付録つき', 10, 'medium');
  }

  // 3. Popular Talent / Custom User VIP S-Rank Tier (+30pt) / Built-in Tier-1 (+20pt) / Tier-2 (+12pt)
  const talentHaystack = [
    ...(item.coverTalents || []),
    ...(item.featuredTalents || []),
    item.title,
    ...visibleOffers.map((o) => o.talent || ''),
  ].join(' ');
  const talentHaystackLower = talentHaystack.toLowerCase();

  const vipHit = (vipTalents || []).find(
    (name) => name && talentHaystackLower.includes(String(name).toLowerCase())
  );
  const tier1Hit = !vipHit
    ? TIER1_POPULAR_TALENTS.find((name) => talentHaystack.includes(name))
    : null;
  const tier2Hit =
    !vipHit && !tier1Hit
      ? TIER2_POPULAR_TALENTS.find((name) => talentHaystack.includes(name))
      : null;

  if (vipHit) {
    addReason('popular_vip', '👑', `マイVIP超人気枠: ${vipHit}`, 30, 'critical');
  } else if (tier1Hit) {
    addReason('popular_t1', '🌟', `超人気: ${tier1Hit}`, 20, 'high');
  } else if (tier2Hit) {
    addReason('popular_t2', '🔥', `注目人気: ${tier2Hit}`, 12, 'medium');
  }

  // 4. User's Oshi Keywords Personal Boost (Configurable: +14 / +24 / +34)
  const matchedOshi = (oshiKeywords || []).filter(
    (kw) => kw && haystackLower.includes(String(kw).toLowerCase())
  );
  const specificOshi = matchedOshi.filter((kw) => !GENERIC_OSHI_KEYWORDS.has(kw));
  if (specificOshi.length > 0) {
    addReason('oshi_hit', '💖', `推しヒット: ${specificOshi[0]}`, boostPreset.points, 'oshi');
  } else if (matchedOshi.length > 0) {
    addReason('oshi_kw', '💖', `登録ワード: ${matchedOshi[0]}`, boostPreset.genericPoints, 'oshi');
  }

  // 5. Exclusive Store Bonus Variant Density + Seasonal Calendar Scarcity
  if (exclusiveOffers.length >= 4) {
    addReason('bonus_density', '🏪', `限定特典${exclusiveOffers.length}種（絵柄争奪）`, 16, 'high');
  } else if (exclusiveOffers.length >= 2) {
    addReason('bonus_density', '🏪', `限定特典${exclusiveOffers.length}種あり`, 11, 'medium');
  } else if (exclusiveOffers.length === 1) {
    addReason('bonus_density', '🏪', 'ストア限定特典あり', 6, 'medium');
  }

  const isCalendarTitle = item.category === 'calendar' || /カレンダー/.test(item.title || '');
  if (isCalendarTitle) {
    addReason('calendar_run', '🗓', '2027カレンダー初回生産', 10, 'medium');
  }

  // 6. Release Timing Urgency (2-3 Month Window)
  if (days >= 0 && days <= 14) {
    const label = days === 0 ? '本日発売・最終確保' : `あと${days}日・予約締切間近`;
    addReason('timing_imminent', '⏰', label, 18, 'critical');
  } else if (days >= 15 && days <= 45) {
    addReason('timing_prime', '📅', `あと${days}日・今が予約ベスト期`, 13, 'high');
  } else if (days >= 46 && days <= URGENT_WINDOW_MAX_DAYS) {
    addReason('timing_early', '🔭', `あと${days}日・先行予約枠`, 8, 'medium');
  } else if (days >= -7 && days < 0) {
    addReason('timing_just_out', '⚡', `発売${Math.abs(days)}日前・初版在庫注意`, 11, 'high');
  } else if (days >= URGENT_WINDOW_MIN_DAYS && days < -7) {
    addReason('timing_recent', '📦', `発売${Math.abs(days)}日前・在庫チェック`, 5, 'neutral');
  }

  // 7. Bonus Artwork Reveal Spike (orders surge once bonus art drops)
  const revealedBonusCount = exclusiveOffers.filter(
    (o) => o.artworkStatus === 'revealed' && Boolean(o.imageUrl)
  ).length;
  if (days >= -3 && revealedBonusCount > 0) {
    addReason('artwork_revealed', '🖼', '特典絵柄解禁済・注文集中', 6, 'medium');
  }

  let score = Math.min(100, rawScore);

  // Forecast-only placeholders haven't opened pre-orders yet -> cap at B-rank watch
  if (isForecastOnly) {
    score = Math.min(score, 44);
    reasons.unshift({
      key: 'forecast_watch',
      icon: '🔔',
      label: '予約解禁スタンバイ枠',
      points: 0,
      tone: 'neutral',
    });
  }

  const rank = score >= 68 ? 'S' : score >= 48 ? 'A' : score >= 30 ? 'B' : 'C';
  const rankMeta = SCARCITY_RANK_META[rank];

  const hotOffers = [...visibleOffers]
    .sort((a, b) => scoreOfferScarcity(b) - scoreOfferScarcity(a))
    .slice(0, 2);

  return {
    score,
    rank,
    rankMeta,
    days,
    inWindow,
    isForecastOnly,
    reasons,
    hotOffers,
    hasSignedOrLimited:
      hasRetailSigned || Boolean(exactRunMatch) || hasLuxuryEdition || hasQtyLimited,
    hasExclusiveCover,
    hasOshiHit: matchedOshi.length > 0 || Boolean(vipHit),
    hasVipHit: Boolean(vipHit),
    isCalendarTitle,
  };
}

/**
 * Returns active-window items ranked by sell-out urgency (score DESC, then soonest upcoming release).
 */
export function getUrgentRadarItems(
  items,
  {
    referenceDate = '2026-11-21',
    oshiKeywords = [],
    vipTalents = [],
    oshiBoostMode = 'strong',
    minScore = 30,
  } = {}
) {
  return (items || [])
    .map((item) => ({
      item,
      scarcity: calculateScarcityScore(item, {
        referenceDate,
        oshiKeywords,
        vipTalents,
        oshiBoostMode,
      }),
    }))
    .filter(({ scarcity }) => scarcity.inWindow && scarcity.score >= minScore)
    .sort((a, b) => {
      if (b.scarcity.score !== a.scarcity.score) {
        return b.scarcity.score - a.scarcity.score;
      }
      const aUp = a.scarcity.days >= 0 ? 0 : 1;
      const bUp = b.scarcity.days >= 0 ? 0 : 1;
      if (aUp !== bUp) return aUp - bUp;
      return Math.abs(a.scarcity.days) - Math.abs(b.scarcity.days);
    });
}
