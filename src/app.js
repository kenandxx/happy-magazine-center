import { createEditorialCoverDataUri, createGalleryPhotoFallbackDataUri } from './cover-art.js';
import {
  BOOKMARKLET_CODE,
  SHARE_BASE_URL,
  extractSafeAmazonUrl,
  isbn13To10,
  lookupBookByIsbnOrUrl,
  parseIncomingSharePayload,
} from './isbn-lookup.js';
import {
  OSHI_BOOST_PRESETS,
  POPULAR_TALENT_PRESETS,
  calculateScarcityScore,
  getUrgentRadarItems,
} from './scarcity-score.js';
import {
  PHOTO_KIND_META,
  buildTalentPromoLinks,
  getOfficialSnsForItem,
} from './social-links.js';
import {
  BONUS_TYPE_META,
  CATEGORY_META,
  STORE_ORDER,
  STORES,
  buildAllStoreSearchLinks,
} from './store-links.js';

const STORAGE_KEYS = {
  oshi: 'hmc_oshi_keywords_v1',
  vipTalents: 'hmc_vip_talents_v1',
  oshiBoost: 'hmc_oshi_boost_v1',
  shelf: 'hmc_shelf_status_v1',
  offerShelf: 'hmc_offer_shelf_v1',
  customItems: 'hmc_custom_items_v1',
  budget: 'hmc_monthly_budget_v1',
  privacyBlur: 'hmc_privacy_blur_v1',
};

const SHELF_STATUS_ORDER = ['considering', 'want', 'reserved', 'owned', 'skip'];

const SHELF_STATUS_PRIORITY = {
  owned: 5,
  reserved: 4,
  want: 3,
  considering: 2,
  skip: 1,
};

const SHELF_STATUS_META = {
  considering: {
    icon: '🤔',
    label: '🤔 検討中',
    short: '検討中',
    hint: '買うか迷い中・あとで見直す',
    colorClass: 'st-considering',
  },
  want: {
    icon: '👀',
    label: '👀 買う予定',
    short: '買う予定',
    hint: '発売日に買う・これから予約',
    colorClass: 'st-want',
  },
  reserved: {
    icon: '🛒',
    label: '🛒 予約済',
    short: '予約済',
    hint: 'この表紙・特典で予約済み',
    colorClass: 'st-reserved',
  },
  owned: {
    icon: '✅',
    label: '✅ 購入済',
    short: '購入済',
    hint: 'この表紙・特典を購入完了',
    colorClass: 'st-owned',
  },
  skip: {
    icon: '🙅',
    label: '🙅 買わない',
    short: '買わない',
    hint: 'この版は見送り',
    colorClass: 'st-skip',
  },
};

const BUDGET_PRESETS = [5000, 10000, 15000, 20000, 30000];

const DEFAULT_OFFER_SHELF = {
  'utb-2027-01-7net-kanazawa': 'want',
  'utb-2027-01-amazon': 'considering',
  'blt-2027-01-7net-1': 'reserved',
  'ga1-7net-ichinose': 'considering',
  'cal-oguri-7net-wall': 'want',
};

const QUICK_HUB_KEYWORDS = [
  '松井珠理奈 アイヲシル',
  '兒玉遥 You will see',
  '高崎かなみ 写真集',
  'B.L.T. 2027年1月号',
  'アップトゥボーイ 2027年1月号',
  '小栗有以 2027 カレンダー',
  '沢口愛華 2027 カレンダー',
  '長濱ねる 2027 カレンダー',
  'グラビアアクション vol.1',
  'SPA! 2026年12月16日号',
  'BUBKA 2027年1月号',
  'BOMB 2027年1月号',
  '小野六花 RIKKA!!',
  '初美なのか - ubu -',
  '河北彩伽 2027 カレンダー',
  '宮下玲奈 Pellicule',
  '園梨音 LOVE ESCAPE',
  '瀬戸環奈 写真集',
  '石川澪 写真集',
  '月刊FANZA',
  '乃木坂46',
  '東雲うみ',
  '一ノ瀬瑠菜',
];

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}

function normalizeStatus(raw) {
  if (!raw) return '';
  if (raw === 'reserved_7net' || raw === 'reserved_other') return 'reserved';
  return SHELF_STATUS_META[raw] ? raw : '';
}

function loadNormalizedStatusMap(key, fallback) {
  const raw = loadJson(key, fallback);
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const norm = normalizeStatus(v);
      if (norm) out[k] = norm;
    }
  }
  return out;
}

function loadValidBoostMode() {
  const raw = loadJson(STORAGE_KEYS.oshiBoost, 'strong');
  return OSHI_BOOST_PRESETS[raw] ? raw : 'strong';
}

const state = {
  referenceDate: '2026-11-21',
  lastAutoCheckedAt: '',
  autoSources: null,
  baseItems: [],
  customItems: loadJson(STORAGE_KEYS.customItems, []),
  oshiKeywords: loadJson(STORAGE_KEYS.oshi, [
    '乃木坂46',
    'ポスター',
    '東雲うみ',
    '沢口愛華',
    '一ノ瀬瑠菜',
    'えなこ',
  ]),
  vipTalents: loadJson(STORAGE_KEYS.vipTalents, []),
  oshiBoostMode: loadValidBoostMode(), // 'standard' (+14) | 'strong' (+24) | 'max' (+34)
  shelfMap: loadNormalizedStatusMap(STORAGE_KEYS.shelf, {}),
  offerShelfMap: loadNormalizedStatusMap(STORAGE_KEYS.offerShelf, DEFAULT_OFFER_SHELF),
  monthlyBudget: Number(loadJson(STORAGE_KEYS.budget, 15000)) || 15000,
  privacyBlur: Boolean(loadJson(STORAGE_KEYS.privacyBlur, false)),
  activeTab: 'discover',
  oshiSubTab: 'oshi', // 'oshi' | 'shelf' | 'tools'
  paletteGroup: 'all', // 'all' | 'idol' | 'gravure' | 'r18' | 'bonus'
  paletteSearch: '',
  viewMode: 'compact', // 'compact' | 'cards' | 'wall'
  offerCompareLayout: 'scroll', // 'scroll' | 'grid'
  search: '',
  category: 'all',
  bonusType: 'all',
  storeFilter: 'all',
  artworkFilter: 'all', // 'all' | 'revealed' | 'pending'
  statusFilter: 'all', // 'all' | 'unmarked' | 'considering' | 'want' | 'reserved' | 'owned' | 'skip'
  oshiOnly: false,
  newAutoOnly: false,
  bonusOnly: false,
  hideSkipped: false,
  sortBy: 'soon',
  urgentRankFilter: 'all', // 'all' | 'S' | 'A' | 'B' | 'secured'
  urgentTopicFilter: 'all', // 'all' | 'auto' | 'limited' | 'cover' | 'oshi' | 'r18' | 'calendar'
  urgentUnreservedOnly: true,
  calendarMonth: 'upcoming', // 'upcoming' | '2026-11' | '2026-12' | '2027-01' | '2027-02' | 'past'
  calendarSubFilter: 'all', // 'all' | 'marked' | 'bonus' | 'pending' | 'calendar' | 'photobook' | 'r18'
  shelfFilter: 'all', // 'all' | 'considering' | 'want' | 'reserved' | 'owned' | 'skip'
  selectedItemId: null,
  selectedOfferStore: 'all',
  selectedPhotoKind: 'all',
  statusPickerItemId: null,
  statusPickerOfferId: null,
  lightboxPhotos: [],
  lightboxIndex: 0,
  isbnLookupPreview: null,
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAllItems() {
  return [...state.customItems, ...state.baseItems];
}

function getItemById(itemId) {
  return getAllItems().find((entry) => entry.id === itemId) || null;
}

function diffDays(dateStr, refDateStr = state.referenceDate) {
  const target = new Date(`${dateStr}T00:00:00`);
  const ref = new Date(`${refDateStr}T00:00:00`);
  return Math.round((target - ref) / (1000 * 60 * 60 * 24));
}

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const yPrefix = d.getFullYear() > 2026 ? `${d.getFullYear()}年` : '';
  return `${yPrefix}${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function formatCountdown(dateStr) {
  const diff = diffDays(dateStr);
  if (diff === 0) return { text: '本日発売！', type: 'today', days: 0 };
  if (diff > 0) return { text: `あと${diff}日`, type: 'upcoming', days: diff };
  return { text: `${Math.abs(diff)}日前発売`, type: 'past', days: diff };
}

function getVisibleOffers(item) {
  return (item?.offers || []).filter((offer) => {
    if (offer.store === 'amazon') return true;
    return offer.hasStoreExclusiveBonus === true;
  });
}

function getAmazonBasePrice(item) {
  const amazonOffer = getVisibleOffers(item).find((o) => o.store === 'amazon');
  return amazonOffer?.price || item.price || 0;
}

/* =========================================================
   Per-Edition (Offer) & Item Status Helpers
   ========================================================= */
function getOfferStatus(offerId) {
  if (!offerId) return '';
  return normalizeStatus(state.offerShelfMap[offerId]);
}

function getLegacyItemStatus(itemId) {
  if (!itemId) return '';
  return normalizeStatus(state.shelfMap[itemId]);
}

function getItemMarkedOffers(item) {
  const result = [];
  for (const offer of getVisibleOffers(item)) {
    const st = getOfferStatus(offer.id);
    if (st) result.push({ offer, status: st });
  }
  return result;
}

function getItemStatusSummary(item) {
  const markedOffers = getItemMarkedOffers(item);
  if (markedOffers.length > 0) {
    let primaryStatus = markedOffers[0].status;
    for (const m of markedOffers) {
      if ((SHELF_STATUS_PRIORITY[m.status] || 0) > (SHELF_STATUS_PRIORITY[primaryStatus] || 0)) {
        primaryStatus = m.status;
      }
    }
    const activeOffers = markedOffers.filter((m) => m.status !== 'skip');
    return {
      mode: 'offers',
      markedOffers,
      primaryStatus,
      activeCount: activeOffers.length,
      allSkipped: activeOffers.length === 0 && markedOffers.length > 0,
    };
  }
  const legacy = getLegacyItemStatus(item.id);
  return {
    mode: legacy ? 'item' : 'none',
    markedOffers: [],
    primaryStatus: legacy,
    activeCount: legacy && legacy !== 'skip' ? 1 : 0,
    allSkipped: legacy === 'skip',
  };
}

function itemHasStatusInBucket(item, filterKey) {
  const summary = getItemStatusSummary(item);
  if (filterKey === 'all') return true;
  if (filterKey === 'unmarked') return summary.mode === 'none';
  if (summary.mode === 'offers') {
    return summary.markedOffers.some((m) => m.status === filterKey);
  }
  return summary.primaryStatus === filterKey;
}

function isItemFullySkipped(item) {
  return getItemStatusSummary(item).allSkipped;
}

function isItemSecured(item) {
  const summary = getItemStatusSummary(item);
  if (summary.mode === 'offers') {
    return summary.markedOffers.some((m) => m.status === 'reserved' || m.status === 'owned');
  }
  return summary.primaryStatus === 'reserved' || summary.primaryStatus === 'owned';
}

/**
 * Returns every marked edition across the entire catalog (or legacy item-level fallback).
 * Used as the single source of truth for Tab 3 Shelf, Monthly Budget Meter, and Bulk .ics export.
 */
function getAllMarkedEntries() {
  const entries = [];
  for (const item of getAllItems()) {
    const markedOffers = getItemMarkedOffers(item);
    if (markedOffers.length > 0) {
      for (const { offer, status } of markedOffers) {
        entries.push({
          key: offer.id,
          item,
          offer,
          status,
          price: Number(offer.price || item.price) || 0,
        });
      }
    } else {
      const legacy = getLegacyItemStatus(item.id);
      if (legacy) {
        entries.push({
          key: `item:${item.id}`,
          item,
          offer: null,
          status: legacy,
          price: Number(item.price) || 0,
        });
      }
    }
  }
  return entries;
}

function syncAfterStatusChange(affectedItemId) {
  saveJson(STORAGE_KEYS.offerShelf, state.offerShelfMap);
  saveJson(STORAGE_KEYS.shelf, state.shelfMap);
  renderCountdownStrip();
  renderFilterChips();
  renderMagazineGrid();
  renderUrgentRadar();
  renderCalendar();
  renderOshiAndShelf();

  if (state.selectedItemId && (!affectedItemId || state.selectedItemId === affectedItemId)) {
    const item = getItemById(state.selectedItemId);
    if (item) renderDetailSheetBody(item);
  }
  if (state.statusPickerItemId && (!affectedItemId || state.statusPickerItemId === affectedItemId)) {
    renderStatusPickerBody();
  }
  if (document.getElementById('photoLightbox').classList.contains('open')) {
    renderLightbox();
  }
}

function setOfferStatus(offerId, status, itemId = null) {
  if (!offerId) return;
  const norm = normalizeStatus(status);
  if (!norm || state.offerShelfMap[offerId] === norm) {
    delete state.offerShelfMap[offerId];
  } else {
    state.offerShelfMap[offerId] = norm;
  }
  // If user marks at edition level, clear any stale legacy item-level mark on the same item
  if (itemId && state.shelfMap[itemId]) {
    delete state.shelfMap[itemId];
  }
  syncAfterStatusChange(itemId);
}

function setLegacyItemStatus(itemId, status) {
  if (!itemId) return;
  const norm = normalizeStatus(status);
  if (!norm || state.shelfMap[itemId] === norm) {
    delete state.shelfMap[itemId];
  } else {
    state.shelfMap[itemId] = norm;
  }
  syncAfterStatusChange(itemId);
}

function formatOfferShortLabel(offer) {
  if (!offer) return '作品全体';
  const st = STORES[offer.store]?.shortName || offer.store;
  const detail = offer.talent && !offer.edition.includes(offer.talent)
    ? `${offer.edition}（${offer.talent}）`
    : offer.edition;
  return `[${st}] ${detail}`;
}

/* =========================================================
   Artwork Reveal Watch Helper
   ========================================================= */
function getItemArtworkWatch(item) {
  const visible = getVisibleOffers(item);
  const bonusOffers = visible.filter((o) => o.hasStoreExclusiveBonus === true);
  const revealedBonusCount = bonusOffers.filter((o) => Boolean(o.imageUrl)).length;
  const pendingBonusCount = bonusOffers.filter((o) => !o.imageUrl).length;
  const hasCover = Boolean(item.coverImageUrl);
  return {
    bonusCount: bonusOffers.length,
    revealedBonusCount,
    pendingBonusCount,
    hasCover,
    hasRevealedBonus: revealedBonusCount > 0,
    hasPendingWatch: pendingBonusCount > 0 || !hasCover,
  };
}

/* =========================================================
   Privacy Blur Toggle (Train Mode for R18)
   ========================================================= */
function applyPrivacyBlur() {
  document.body.classList.toggle('privacy-blur-r18', state.privacyBlur);
  const btn = document.getElementById('privacyBlurBtn');
  if (btn) {
    btn.classList.toggle('active', state.privacyBlur);
    btn.setAttribute('aria-pressed', state.privacyBlur ? 'true' : 'false');
    btn.textContent = state.privacyBlur ? '🚃 R18ぼかし中' : '🚃 電車モード';
  }
}

function togglePrivacyBlur() {
  state.privacyBlur = !state.privacyBlur;
  saveJson(STORAGE_KEYS.privacyBlur, state.privacyBlur);
  applyPrivacyBlur();
}

/* =========================================================
   Photos & Quick-Preview Slides
   ========================================================= */
function getItemPhotos(item) {
  const list = [];
  const seenUrls = new Set();
  const amazonBasePrice = getAmazonBasePrice(item);
  const visibleOffers = getVisibleOffers(item);
  const amazonOffer = visibleOffers.find((o) => o.store === 'amazon') || visibleOffers[0] || null;

  const pushPhoto = (photo) => {
    const key = photo.url || `fallback-${photo.caption}`;
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    list.push({
      itemId: item.id,
      itemTitle: item.title,
      itemCategory: item.category,
      url: photo.url || '',
      caption: photo.caption || item.title,
      source: photo.source || item.publisher || '',
      kind: photo.kind || 'cover',
      tabLabel: photo.tabLabel || PHOTO_KIND_META[photo.kind]?.label || '写真',
      articleUrl: photo.articleUrl || amazonOffer?.url || '#',
      offer: photo.offer || null,
      isPendingArt: Boolean(photo.isPendingArt),
      amazonBasePrice,
      fallbackUri: createGalleryPhotoFallbackDataUri(item, photo),
    });
  };

  // Match gallery entries with their corresponding offer if URL matches
  const offerByImg = new Map();
  for (const offer of visibleOffers) {
    if (offer.imageUrl && !offerByImg.has(offer.imageUrl)) {
      offerByImg.set(offer.imageUrl, offer);
    }
  }

  for (const g of item.gallery || []) {
    pushPhoto({
      ...g,
      offer: offerByImg.get(g.url) || amazonOffer,
    });
  }

  for (const offer of visibleOffers) {
    if (offer.imageUrl) {
      const storeName = STORES[offer.store]?.name || offer.store;
      const storeShort = STORES[offer.store]?.shortName || offer.store;
      pushPhoto({
        url: offer.imageUrl,
        caption: `${storeName}｜${offer.edition}：${offer.bonusText}`,
        source: storeName,
        kind: (offer.bonusTypes || []).includes('cover') ? 'limited_cover' : 'bonus',
        tabLabel: `${storeShort}${offer.hasStoreExclusiveBonus ? '特典' : ''}`,
        articleUrl: offer.url,
        offer,
      });
    }
  }

  if (list.length === 0) {
    const coverFallback = createEditorialCoverDataUri(item);
    list.push({
      itemId: item.id,
      itemTitle: item.title,
      itemCategory: item.category,
      url: item.coverImageUrl || coverFallback,
      caption: `${item.title}（${(item.coverTalents || []).join('・')}）`,
      source: item.publisher || '公式書影',
      kind: 'cover',
      tabLabel: '表紙',
      articleUrl: (item.pressArticles && item.pressArticles[0]?.url) || amazonOffer?.url || '#',
      offer: amazonOffer,
      isPendingArt: false,
      amazonBasePrice,
      fallbackUri: coverFallback,
    });
  }

  return list;
}

function buildQuickPreviewPhotos(item) {
  const slides = [];
  const seenOfferUrls = new Set();
  const visibleOffers = getVisibleOffers(item);
  const amazonBasePrice = getAmazonBasePrice(item);
  const coverUrl = item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || '';
  const coverFallback = createEditorialCoverDataUri(item);
  const amazonOffer = visibleOffers.find((o) => o.store === 'amazon') || visibleOffers[0] || null;

  slides.push({
    itemId: item.id,
    itemTitle: item.title,
    itemCategory: item.category,
    url: coverUrl || coverFallback,
    caption: `${item.title}（${(item.coverTalents || []).join('・')}）`,
    source: `${item.publisher || '公式書影'} ・ ${formatDateLabel(item.releaseDate)}`,
    kind: 'cover',
    tabLabel: '📘 表紙',
    articleUrl: amazonOffer?.url || '#',
    offer: amazonOffer,
    isPendingArt: !item.coverImageUrl,
    amazonBasePrice,
    fallbackUri: coverFallback,
  });

  // Other Amazon variants (e.g. Wall vs Desk calendar)
  const extraAmazonOffers = visibleOffers.filter(
    (o) => o.store === 'amazon' && amazonOffer && o.id !== amazonOffer.id
  );
  extraAmazonOffers.forEach((offer) => {
    if (offer.imageUrl) seenOfferUrls.add(offer.imageUrl);
    slides.push({
      itemId: item.id,
      itemTitle: item.title,
      itemCategory: item.category,
      url: offer.imageUrl || coverUrl || coverFallback,
      caption: `Amazon｜${offer.edition}：${offer.bonusText}`,
      source: 'Amazon',
      kind: 'limited_cover',
      tabLabel: `📘 ${offer.edition.replace(/^Amazon\s*/, '')}`,
      articleUrl: offer.url,
      offer,
      isPendingArt: !offer.imageUrl,
      amazonBasePrice,
      fallbackUri: coverFallback,
    });
  });

  // Store-exclusive bonus variants
  const bonusOffers = visibleOffers.filter((o) => o.hasStoreExclusiveBonus === true);
  bonusOffers.forEach((offer, idx) => {
    const st = STORES[offer.store] || { name: offer.store, shortName: offer.store };
    const kind = (offer.bonusTypes || []).includes('cover') ? 'limited_cover' : 'bonus';
    const hasRealArt = Boolean(offer.imageUrl);
    if (hasRealArt) seenOfferUrls.add(offer.imageUrl);

    slides.push({
      itemId: item.id,
      itemTitle: item.title,
      itemCategory: item.category,
      url: offer.imageUrl || coverUrl || coverFallback,
      caption: `${st.name}｜${offer.edition}：${offer.bonusText}`,
      source: hasRealArt ? `${st.name}（特典絵柄公開済）` : `${st.name}（表紙表示・特典絵柄解禁待ち）`,
      kind,
      tabLabel: `${hasRealArt ? '✨' : '⏳'}${st.shortName}${bonusOffers.length > 1 ? idx + 1 : ''}`,
      articleUrl: offer.url,
      offer,
      isPendingArt: !hasRealArt,
      amazonBasePrice,
      fallbackUri: createGalleryPhotoFallbackDataUri(item, {
        caption: `${offer.edition} ${offer.talent || ''}`.trim(),
        source: st.name,
        kind,
      }),
    });
  });

  let previewCount = 0;
  for (const g of item.gallery || []) {
    if (!g.url) continue;
    if (g.url === coverUrl || seenOfferUrls.has(g.url)) continue;
    seenOfferUrls.add(g.url);
    previewCount += 1;
    const km = PHOTO_KIND_META[g.kind] || { icon: '📷', label: 'カット' };
    slides.push({
      itemId: item.id,
      itemTitle: item.title,
      itemCategory: item.category,
      url: g.url,
      caption: g.caption || item.title,
      source: g.source || item.publisher || '公式公開写真',
      kind: g.kind || 'preview',
      tabLabel: `${km.icon}${km.label}${previewCount > 1 ? previewCount : ''}`,
      articleUrl: g.articleUrl || bonusOffers[0]?.url || amazonOffer?.url || '#',
      offer: bonusOffers[0] || amazonOffer,
      isPendingArt: false,
      amazonBasePrice,
      fallbackUri: createGalleryPhotoFallbackDataUri(item, g),
    });
  }

  return slides;
}

function openQuickPreview(itemId, startIndex = 0) {
  const item = getItemById(itemId);
  if (!item) return;
  const slides = buildQuickPreviewPhotos(item);
  openLightbox(slides, startIndex);
}

function syncAfterOshiOrVipChange() {
  saveJson(STORAGE_KEYS.oshi, state.oshiKeywords);
  saveJson(STORAGE_KEYS.vipTalents, state.vipTalents);
  saveJson(STORAGE_KEYS.oshiBoost, state.oshiBoostMode);
  renderCountdownStrip();
  renderFilterChips();
  renderMagazineGrid();
  renderUrgentRadar();
  renderOshiAndShelf();
  if (state.selectedItemId) {
    const item = getItemById(state.selectedItemId);
    if (item) renderDetailSheetBody(item);
  }
}

function toggleOshiKeyword(rawName, forceAdd = false) {
  const kw = String(rawName || '').trim();
  if (!kw) return;
  const exists = state.oshiKeywords.includes(kw);
  if (exists && !forceAdd) {
    state.oshiKeywords = state.oshiKeywords.filter((k) => k !== kw);
  } else if (!exists) {
    state.oshiKeywords.unshift(kw);
  }
  syncAfterOshiOrVipChange();
}

function toggleVipTalent(rawName, forceAdd = false) {
  const kw = String(rawName || '').trim();
  if (!kw) return;
  const exists = state.vipTalents.includes(kw);
  if (exists && !forceAdd) {
    state.vipTalents = state.vipTalents.filter((k) => k !== kw);
  } else if (!exists) {
    state.vipTalents.unshift(kw);
    if (!state.oshiKeywords.includes(kw)) {
      state.oshiKeywords.unshift(kw);
    }
  }
  syncAfterOshiOrVipChange();
}

function setOshiBoostMode(mode) {
  if (!OSHI_BOOST_PRESETS[mode]) return;
  state.oshiBoostMode = mode;
  syncAfterOshiOrVipChange();
}

function extractCleanTalentNames(item) {
  const out = [];
  const seen = new Set();
  const skipPattern = /解禁待ち|グラビア特集|合併号|特別グラビア|例月\d+日|袋とじ/;
  for (const raw of item.coverTalents || []) {
    const str = String(raw || '').trim();
    if (!str || skipPattern.test(str)) continue;
    // Split e.g. "川﨑桜（乃木坂46）" into ["川﨑桜", "乃木坂46"]
    const match = str.match(/^([^（(]+)[（(]([^）)]+)[）)]$/);
    const parts = match ? [match[1].trim(), match[2].trim()] : [str];
    for (const p of parts) {
      if (!p || p.length < 2 || skipPattern.test(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out.slice(0, 6);
}

function buildItemHaystackLower(item) {
  return [
    item.title,
    item.series,
    item.publisher,
    item.summary,
    ...(item.coverTalents || []),
    ...(item.featuredTalents || []),
    ...(item.includedBonuses || []).map((b) => b.label),
    ...(item.offers || []).map((o) => `${o.edition} ${o.bonusText} ${o.talent || ''}`),
  ]
    .join(' ')
    .toLowerCase();
}

function countItemsMatchingKeyword(kw) {
  const q = String(kw || '').trim().toLowerCase();
  if (!q) return 0;
  let cnt = 0;
  for (const item of getAllItems()) {
    if (buildItemHaystackLower(item).includes(q)) cnt++;
  }
  return cnt;
}

function itemMatchesOshi(item) {
  const combined = [...new Set([...state.vipTalents, ...state.oshiKeywords])];
  if (!combined.length) return [];
  const haystack = buildItemHaystackLower(item);
  return combined.filter((kw) => kw && haystack.includes(kw.toLowerCase()));
}

function exportUserDataBackup() {
  const payload = {
    app: 'Happy Magazine Center',
    version: '0.9',
    exportedAt: new Date().toISOString(),
    data: {
      oshiKeywords: state.oshiKeywords,
      vipTalents: state.vipTalents,
      oshiBoostMode: state.oshiBoostMode,
      offerShelfMap: state.offerShelfMap,
      shelfMap: state.shelfMap,
      monthlyBudget: state.monthlyBudget,
      privacyBlur: state.privacyBlur,
      customItems: state.customItems,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `happy-magazine-backup-${state.referenceDate}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const msg = document.getElementById('backupStatusMsg');
  if (msg) {
    msg.textContent = `✅ バックアップを保存しました（推し ${state.oshiKeywords.length}件・VIP ${state.vipTalents.length}件・マーク ${Object.keys(state.offerShelfMap).length}版）`;
  }
}

function importUserDataBackup(file) {
  const msg = document.getElementById('backupStatusMsg');
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      const d = parsed.data || parsed;
      if (Array.isArray(d.oshiKeywords)) state.oshiKeywords = d.oshiKeywords.filter(Boolean);
      if (Array.isArray(d.vipTalents)) state.vipTalents = d.vipTalents.filter(Boolean);
      if (d.oshiBoostMode && OSHI_BOOST_PRESETS[d.oshiBoostMode]) {
        state.oshiBoostMode = d.oshiBoostMode;
      }
      if (d.offerShelfMap && typeof d.offerShelfMap === 'object') {
        state.offerShelfMap = d.offerShelfMap;
      }
      if (d.shelfMap && typeof d.shelfMap === 'object') {
        state.shelfMap = d.shelfMap;
      }
      if (Number(d.monthlyBudget) >= 1000) {
        state.monthlyBudget = Number(d.monthlyBudget);
      }
      if (typeof d.privacyBlur === 'boolean') {
        state.privacyBlur = d.privacyBlur;
      }
      if (Array.isArray(d.customItems)) {
        state.customItems = d.customItems;
      }
      saveJson(STORAGE_KEYS.oshi, state.oshiKeywords);
      saveJson(STORAGE_KEYS.vipTalents, state.vipTalents);
      saveJson(STORAGE_KEYS.oshiBoost, state.oshiBoostMode);
      saveJson(STORAGE_KEYS.offerShelf, state.offerShelfMap);
      saveJson(STORAGE_KEYS.shelf, state.shelfMap);
      saveJson(STORAGE_KEYS.budget, state.monthlyBudget);
      saveJson(STORAGE_KEYS.privacyBlur, state.privacyBlur);
      saveJson(STORAGE_KEYS.customItems, state.customItems);
      renderAll();
      if (msg) {
        msg.textContent = `✅ バックアップを復元しました！（推し ${state.oshiKeywords.length}件・VIP ${state.vipTalents.length}件・マーク ${Object.keys(state.offerShelfMap).length}版）`;
      }
    } catch {
      if (msg) {
        msg.textContent = '⚠️ JSONファイルの読み込みに失敗しました。バックアップファイルを確認してください。';
      }
    }
  };
  reader.readAsText(file);
}

function getItemBonusTypes(item) {
  const types = new Set();
  for (const b of item.includedBonuses || []) {
    if (b.type) types.add(b.type);
  }
  for (const offer of getVisibleOffers(item)) {
    for (const bt of offer.bonusTypes || []) {
      if (bt !== 'standard') types.add(bt);
    }
  }
  return [...types];
}

function getItemSpecialBonusCount(item) {
  const included = (item.includedBonuses || []).length;
  const storeSpecials = getVisibleOffers(item).filter(
    (o) => o.hasStoreExclusiveBonus === true || (o.bonusTypes || []).some((bt) => bt !== 'standard')
  ).length;
  return included + storeSpecials;
}

function getFilteredItems() {
  const q = state.search.trim().toLowerCase();

  const filtered = getAllItems().filter((item) => {
    if (state.category !== 'all' && item.category !== state.category) return false;

    const bonusTypes = getItemBonusTypes(item);
    if (state.bonusType !== 'all' && !bonusTypes.includes(state.bonusType)) return false;

    if (state.storeFilter !== 'all') {
      const hasStore = getVisibleOffers(item).some((o) => o.store === state.storeFilter);
      if (!hasStore) return false;
    }

    if (state.artworkFilter !== 'all') {
      const watch = getItemArtworkWatch(item);
      if (state.artworkFilter === 'revealed' && !watch.hasRevealedBonus) return false;
      if (state.artworkFilter === 'pending' && !watch.hasPendingWatch) return false;
    }

    if (state.hideSkipped && isItemFullySkipped(item) && state.statusFilter !== 'skip') return false;
    if (!itemHasStatusInBucket(item, state.statusFilter)) return false;

    if (state.oshiOnly && itemMatchesOshi(item).length === 0) return false;
    if (state.newAutoOnly && !item.autoDiscovered) return false;
    if (state.bonusOnly && getItemSpecialBonusCount(item) === 0) return false;

    if (q) {
      const text = [
        item.title,
        item.series,
        item.publisher,
        item.summary,
        item.releaseDate,
        item.category === 'r18' ? 'r18 アダルト ヘアヌード セクシー' : '',
        ...(item.coverTalents || []),
        ...(item.featuredTalents || []),
        ...(item.includedBonuses || []).map((b) => b.label),
        ...(item.offers || []).map((o) => `${o.store} ${o.edition} ${o.bonusText} ${o.talent || ''}`),
        ...(item.gallery || []).map((g) => `${g.caption} ${g.source}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    const aSkip = isItemFullySkipped(a) ? 1 : 0;
    const bSkip = isItemFullySkipped(b) ? 1 : 0;
    if (aSkip !== bSkip && state.statusFilter !== 'skip') return aSkip - bSkip;

    const aOshi = itemMatchesOshi(a).length > 0 ? 1 : 0;
    const bOshi = itemMatchesOshi(b).length > 0 ? 1 : 0;

    if (state.sortBy === 'bonuses') {
      const diff = getItemSpecialBonusCount(b) - getItemSpecialBonusCount(a);
      if (diff !== 0) return diff;
    } else if (state.sortBy === 'photos') {
      const diff = getItemPhotos(b).length - getItemPhotos(a).length;
      if (diff !== 0) return diff;
    } else if (state.sortBy === 'newest') {
      const diff = new Date(b.releaseDate) - new Date(a.releaseDate);
      if (diff !== 0) return diff;
    } else {
      const da = diffDays(a.releaseDate);
      const db = diffDays(b.releaseDate);
      const aUpcoming = da >= 0;
      const bUpcoming = db >= 0;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      if (aUpcoming) {
        if (da !== db) return da - db;
      } else if (da !== db) {
        return db - da;
      }
    }

    return bOshi - aOshi;
  });

  return filtered;
}

function renderCoverImg(item, className = '') {
  const fallback = createEditorialCoverDataUri(item);
  const src = item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || fallback;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(
    item.title
  )}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallback}';" />`;
}

function renderOfferThumbImg(item, offer, className = '') {
  const fallback = createEditorialCoverDataUri(item);
  const src = offer?.imageUrl || item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || fallback;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(
    offer ? `${item.title} ${offer.edition}` : item.title
  )}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallback}';" />`;
}

function renderPhotoImg(photo, className = '') {
  const src = photo.url || photo.fallbackUri;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(
    photo.caption
  )}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${photo.fallbackUri}';" />`;
}

function renderStatusMarkButton(item, compact = false, offerId = null) {
  if (offerId) {
    const st = getOfferStatus(offerId);
    if (!st) {
      return `<button
        class="status-mark-btn is-unmarked"
        type="button"
        data-open-status-picker="${escapeHtml(item.id)}"
        data-picker-offer="${escapeHtml(offerId)}"
        aria-label="この版のステータスをマーク"
      >${compact ? '🏷＋' : '🏷 マーク'}</button>`;
    }
    const meta = SHELF_STATUS_META[st];
    return `<button
      class="status-mark-btn ${meta.colorClass}"
      type="button"
      data-open-status-picker="${escapeHtml(item.id)}"
      data-picker-offer="${escapeHtml(offerId)}"
      aria-label="この版のステータス変更：${escapeHtml(meta.label)}"
    >${meta.icon}${compact ? '' : ' '}${escapeHtml(meta.short)}</button>`;
  }

  const summary = getItemStatusSummary(item);
  if (summary.mode === 'none') {
    return `<button
      class="status-mark-btn is-unmarked"
      type="button"
      data-open-status-picker="${escapeHtml(item.id)}"
      aria-label="表紙・特典別にステータスをマーク"
      title="表紙・特典ごとに検討中・買う予定・予約済・購入済をマーク"
    >${compact ? '🏷＋' : '🏷 マーク'}</button>`;
  }

  const meta = SHELF_STATUS_META[summary.primaryStatus];
  let labelText = meta.short;
  if (summary.mode === 'offers') {
    if (summary.markedOffers.length === 1) {
      const o = summary.markedOffers[0].offer;
      const storeShort = STORES[o.store]?.shortName || o.store;
      labelText = compact ? storeShort : `${meta.short}(${storeShort})`;
    } else {
      labelText = compact ? `${summary.markedOffers.length}版` : `${meta.short}他${summary.markedOffers.length}版`;
    }
  }

  return `<button
    class="status-mark-btn ${meta.colorClass}"
    type="button"
    data-open-status-picker="${escapeHtml(item.id)}"
    aria-label="ステータス変更：${escapeHtml(labelText)}"
    title="表紙・特典別にマーク管理（タップで切替）"
  >${meta.icon}${compact ? '' : ' '}${escapeHtml(labelText)}</button>`;
}

function renderCountdownStrip() {
  const container = document.getElementById('countdownStrip');
  const radarEntries = getUrgentRadarItems(getAllItems(), {
    referenceDate: state.referenceDate,
    oshiKeywords: state.oshiKeywords,
    vipTalents: state.vipTalents,
    oshiBoostMode: state.oshiBoostMode,
  });
  const unreservedS = radarEntries.filter(
    ({ item, scarcity }) =>
      scarcity.rank === 'S' && !isItemSecured(item) && !isItemFullySkipped(item)
  ).length;
  const unreservedSA = radarEntries.filter(
    ({ item, scarcity }) =>
      (scarcity.rank === 'S' || scarcity.rank === 'A') &&
      !isItemSecured(item) &&
      !isItemFullySkipped(item)
  ).length;

  const urgentJumpChip =
    unreservedSA > 0
      ? `<button class="countdown-urgent-jump" type="button" data-jump-tab="urgent">
          <span class="countdown-urgent-jump-title">🔥 早め予約・争奪戦 →</span>
          <span class="countdown-urgent-jump-sub">🔴Sランク ${unreservedS}件 / 要確保 ${unreservedSA}件</span>
        </button>`
      : '';

  const upcoming = getAllItems()
    .filter((item) => diffDays(item.releaseDate) >= 0 && !isItemFullySkipped(item))
    .sort((a, b) => diffDays(a.releaseDate) - diffDays(b.releaseDate))
    .slice(0, 10);

  container.innerHTML =
    urgentJumpChip +
    upcoming
      .map((item) => {
        const cd = formatCountdown(item.releaseDate);
        const specialCount = getItemSpecialBonusCount(item);
        const summary = getItemStatusSummary(item);
        const stIcon = summary.primaryStatus ? `${SHELF_STATUS_META[summary.primaryStatus].icon} ` : '';
        return `
        <button class="countdown-chip" type="button" data-open-id="${escapeHtml(item.id)}">
          <span class="countdown-days ${cd.type === 'today' ? 'today' : ''}">${escapeHtml(cd.text)}</span>
          <div class="countdown-meta">
            <div class="countdown-title">${stIcon}${escapeHtml(item.title)}</div>
            <div class="countdown-sub">${escapeHtml(formatDateLabel(item.releaseDate))} ・ 🎁${specialCount}</div>
          </div>
        </button>
      `;
      })
      .join('');
}

function renderFilterChips() {
  const allItems = getAllItems();
  const oshiMatchCount = allItems.filter((it) => itemMatchesOshi(it).length > 0).length;
  const oshiOnlyLabel = document.getElementById('oshiOnlyLabel');
  if (oshiOnlyLabel) {
    oshiOnlyLabel.textContent = `💖 推しのみ (${oshiMatchCount})`;
  }
  const oshiOnlyToggle = document.getElementById('oshiOnlyToggle');
  if (oshiOnlyToggle) {
    oshiOnlyToggle.checked = state.oshiOnly;
  }

  const autoDiscoveredCount = allItems.filter((it) => Boolean(it.autoDiscovered)).length;
  const newAutoOnlyLabel = document.getElementById('newAutoOnlyLabel');
  if (newAutoOnlyLabel) {
    newAutoOnlyLabel.textContent = `🆕 自動発見 (${autoDiscoveredCount})`;
  }
  const newAutoOnlyToggle = document.getElementById('newAutoOnlyToggle');
  if (newAutoOnlyToggle) {
    newAutoOnlyToggle.checked = state.newAutoOnly;
  }

  document.getElementById('categoryChips').innerHTML = Object.entries(CATEGORY_META)
    .map(([id, meta]) => {
      const cnt = id === 'all' ? allItems.length : allItems.filter((it) => it.category === id).length;
      return `
      <button class="filter-chip ${state.category === id ? 'active' : ''}" type="button" data-cat="${id}">
        ${escapeHtml(meta.label)} (${cnt})
      </button>
    `;
    })
    .join('');

  const bonusChoices = [
    { id: 'all', label: '🎁 全特典' },
    { id: 'poster', label: '🖼 ポスター' },
    { id: 'postcard', label: '📮 ポストカード' },
    { id: 'photo', label: '📸 生写真' },
    { id: 'cover', label: '✨ 限定表紙' },
    { id: 'dvd', label: '📀 DVD' },
    { id: 'signed', label: '✒️ サイン本' },
  ];

  document.getElementById('bonusChips').innerHTML = bonusChoices
    .map(
      (choice) => `
      <button class="filter-chip ${state.bonusType === choice.id ? 'active' : ''}" type="button" data-bonus="${choice.id}">
        ${escapeHtml(choice.label)}
      </button>
    `
    )
    .join('');

  const storeChoices = [
    { id: 'all', label: '🏪 全ストア' },
    ...STORE_ORDER.map((id) => ({
      id,
      label: id === 'amazon' ? 'Amazon' : `${STORES[id].shortName}特典あり`,
    })),
  ];

  document.getElementById('storeChips').innerHTML = storeChoices
    .map(
      (choice) => `
      <button class="filter-chip ${state.storeFilter === choice.id ? 'store-active' : ''}" type="button" data-store="${choice.id}">
        ${escapeHtml(choice.label)}
      </button>
    `
    )
    .join('');

  // Artwork Reveal Watch chips
  const revealedCnt = allItems.filter((it) => getItemArtworkWatch(it).hasRevealedBonus).length;
  const pendingCnt = allItems.filter((it) => getItemArtworkWatch(it).hasPendingWatch).length;
  const artworkChoices = [
    { id: 'all', label: '🖼 絵柄すべて' },
    { id: 'revealed', label: `✨ 特典絵柄公開済 (${revealedCnt})` },
    { id: 'pending', label: `⏳ 絵柄・表紙解禁待ち (${pendingCnt})` },
  ];

  const artEl = document.getElementById('artworkChips');
  if (artEl) {
    artEl.innerHTML = artworkChoices
      .map(
        (choice) => `
        <button class="filter-chip ${state.artworkFilter === choice.id ? 'active' : ''}" type="button" data-artwork-filter="${choice.id}">
          ${escapeHtml(choice.label)}
        </button>
      `
      )
      .join('');
  }

  // Status filter chips (reflecting per-edition marks)
  const statusCounts = {
    all: allItems.length,
    unmarked: 0,
    considering: 0,
    want: 0,
    reserved: 0,
    owned: 0,
    skip: 0,
  };
  for (const it of allItems) {
    if (itemHasStatusInBucket(it, 'unmarked')) statusCounts.unmarked += 1;
    for (const k of SHELF_STATUS_ORDER) {
      if (itemHasStatusInBucket(it, k)) statusCounts[k] += 1;
    }
  }

  const statusChoices = [
    { id: 'all', label: `🏷 全ステータス (${statusCounts.all})` },
    { id: 'unmarked', label: `⬜ 未判定 (${statusCounts.unmarked})` },
    { id: 'considering', label: `🤔 検討中 (${statusCounts.considering})` },
    { id: 'want', label: `👀 買う予定 (${statusCounts.want})` },
    { id: 'reserved', label: `🛒 予約済 (${statusCounts.reserved})` },
    { id: 'owned', label: `✅ 購入済 (${statusCounts.owned})` },
    { id: 'skip', label: `🙅 買わない (${statusCounts.skip})` },
  ];

  document.getElementById('statusChips').innerHTML = statusChoices
    .map(
      (choice) => `
      <button class="filter-chip ${state.statusFilter === choice.id ? 'active' : ''}" type="button" data-status-filter="${choice.id}">
        ${escapeHtml(choice.label)}
      </button>
    `
    )
    .join('');

  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewMode === state.viewMode);
  });
}

function renderPhotoWall(items) {
  const grid = document.getElementById('magazineGrid');
  grid.className = 'photo-wall-grid';

  const allPhotos = [];
  for (const item of items) {
    for (const photo of getItemPhotos(item)) {
      allPhotos.push(photo);
    }
  }

  document.getElementById(
    'resultsCount'
  ).innerHTML = `<strong>${allPhotos.length}</strong>枚の関連写真（${items.length}作品）`;

  if (!allPhotos.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>表示する写真がありません。</p></div>`;
    return;
  }

  grid.innerHTML = allPhotos
    .map((photo, idx) => {
      const kindMeta = PHOTO_KIND_META[photo.kind] || { icon: '📷', label: '関連写真' };
      const r18Class = photo.itemCategory === 'r18' ? 'is-r18-media' : '';
      return `
        <article class="wall-tile" data-wall-photo-idx="${idx}">
          <div class="wall-photo-box ${r18Class}">
            ${renderPhotoImg(photo)}
            <span class="wall-kind-tag">${kindMeta.icon} ${escapeHtml(kindMeta.label)}</span>
          </div>
          <div class="wall-caption-box">
            <div class="wall-caption-title">${escapeHtml(photo.caption)}</div>
            <div class="wall-caption-sub">${escapeHtml(photo.itemTitle)} ・ ${escapeHtml(photo.source)}</div>
          </div>
        </article>
      `;
    })
    .join('');

  grid._wallPhotos = allPhotos;
}

function renderCompactGrid(items) {
  const grid = document.getElementById('magazineGrid');
  grid.className = 'compact-grid';

  grid.innerHTML = items
    .map((item) => {
      const cd = formatCountdown(item.releaseDate);
      const oshiHits = itemMatchesOshi(item);
      const fullySkipped = isItemFullySkipped(item);
      const photos = getItemPhotos(item);
      const visibleOffers = getVisibleOffers(item);
      const bonusOffersCount = visibleOffers.filter((o) => o.hasStoreExclusiveBonus === true).length;
      const watch = getItemArtworkWatch(item);

      const storeBadges = STORE_ORDER.map((storeId) => {
        const offers = visibleOffers.filter((o) => o.store === storeId);
        if (!offers.length) return '';
        const sp = offers.filter((o) => o.hasStoreExclusiveBonus === true).length;
        if (storeId === 'amazon' && bonusOffersCount > 0) return '';
        const store = STORES[storeId];
        return `<span class="compact-store-pill ${store.badgeClass}">${escapeHtml(store.shortName)}${
          sp > 0 ? `特典${sp}` : ''
        }</span>`;
      }).join('');

      const includedTag = (item.includedBonuses || []).length
        ? `<span class="compact-store-pill" style="background:#fef3c7;color:#92400e;">${
            BONUS_TYPE_META[item.includedBonuses[0].type]?.icon || '🎁'
          }付録</span>`
        : '';

      const watchBadge =
        watch.bonusCount > 0
          ? watch.pendingBonusCount === 0
            ? `<span class="compact-store-pill" style="background:#dcfce7;color:#166534;">✨絵柄公開</span>`
            : `<span class="compact-store-pill" style="background:#fef3c7;color:#92400e;">⏳絵柄待${watch.pendingBonusCount}</span>`
          : '';

      const dateShort = item.releaseDate.slice(5).replace('-', '/');
      const r18Class = item.category === 'r18' ? 'is-r18-media' : '';

      return `
        <article class="compact-card ${oshiHits.length ? 'oshi-match' : ''} ${
        fullySkipped ? 'is-skipped' : ''
      }" data-open-id="${escapeHtml(item.id)}">
          <div class="compact-cover-box ${r18Class}">
            ${renderCoverImg(item)}
            <div class="compact-top-bar">
              <span class="compact-cd-pill ${cd.type === 'today' ? 'is-today' : ''}">${
                cd.type === 'today' ? '本日発売' : `${dateShort} ${cd.text}`
              }</span>
              <div class="compact-top-right">
                ${renderStatusMarkButton(item, true)}
              </div>
            </div>
            <button
              class="compact-zoom-btn"
              type="button"
              data-quick-preview="${escapeHtml(item.id)}"
              aria-label="${escapeHtml(item.title)}をワンタップで確認"
              title="ワンタップで写真＆特典確認"
            >🔍 確認${photos.length > 1 ? `(${photos.length})` : ''}</button>
            <div class="compact-bottom-scrim">
              ${item.autoDiscovered ? `<span class="compact-store-pill new-auto-pill">🆕自動発見</span>` : ''}
              ${
                item.category === 'r18'
                  ? `<span class="compact-store-pill r18-pill">🔞R18</span>`
                  : item.category === 'calendar'
                    ? `<span class="compact-store-pill" style="background:#312e81;color:#fff;">🗓カレンダー</span>`
                    : ''
              }
              ${oshiHits.length ? `<span class="compact-store-pill" style="background:var(--accent);color:#fff;">🔥${escapeHtml(oshiHits[0])}</span>` : ''}
              ${storeBadges}
              ${watchBadge}
              ${includedTag}
            </div>
          </div>
          <div class="compact-meta">
            <h2 class="compact-title">${escapeHtml(item.title)}</h2>
            <p class="compact-talent">${escapeHtml((item.coverTalents || []).join(' / '))}</p>
            <div class="compact-price-row">
              <span>¥${(item.price || 0).toLocaleString()}</span>
              <span class="compact-compare-hint">${
                visibleOffers.length > 1 ? `🎁${visibleOffers.length}種比較→` : '詳細→'
              }</span>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderMagazineGrid() {
  const items = getFilteredItems();

  if (state.viewMode === 'wall') {
    renderPhotoWall(items);
    return;
  }

  const grid = document.getElementById('magazineGrid');
  const totalPhotos = items.reduce((sum, item) => sum + getItemPhotos(item).length, 0);
  document.getElementById(
    'resultsCount'
  ).innerHTML = `<strong>${items.length}</strong>作品 ・ 関連写真 <strong>${totalPhotos}</strong>枚`;

  if (!items.length) {
    grid.className = 'mag-grid';
    const q = state.search.trim();
    const issueUrl = `https://github.com/kenandxx/happy-magazine-center/issues/new?title=${encodeURIComponent(
      `【収録リクエスト】${q || '新刊追加'}`
    )}&body=${encodeURIComponent(
      `作品名・タレント名：${q}\nAmazon URL または ISBN：\n特典メモ：`
    )}`;
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <strong>条件に合う雑誌・写真集・カレンダーがありません</strong>
        <p>${
          q
            ? `「${escapeHtml(q)}」をAmazon URL / ISBNから1タップ自動取込するか、全5ストア横断検索で探せます！`
            : 'フィルターを緩めるか、Amazon URL / ISBN自動取込・横断検索タブから任意のタイトルを追加できます。'
        }</p>
        <div class="empty-state-actions">
          <button class="primary-btn" type="button" data-jump-isbn-import="1">⚡ Amazon URL / ISBN 自動取込</button>
          <button class="quick-preview-icon-btn" type="button" id="jumpToHubBtn">🔍 全ストア横断検索へ</button>
          ${
            q
              ? `<a class="isbn-request-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">📮 「${escapeHtml(q)}」を公式収録依頼 ↗</a>`
              : ''
          }
        </div>
      </div>
    `;
    const jumpBtn = document.getElementById('jumpToHubBtn');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        if (q) {
          document.getElementById('hubQueryInput').value = q;
          renderHubLauncher();
        }
        switchTab('hub');
      });
    }
    return;
  }

  if (state.viewMode === 'compact') {
    renderCompactGrid(items);
    return;
  }

  grid.className = 'mag-grid';

  grid.innerHTML = items
    .map((item) => {
      const cd = formatCountdown(item.releaseDate);
      const oshiHits = itemMatchesOshi(item);
      const fullySkipped = isItemFullySkipped(item);
      const bonusTypes = getItemBonusTypes(item);
      const photos = getItemPhotos(item);
      const pressCount = (item.pressArticles || []).length;
      const watch = getItemArtworkWatch(item);
      const r18Class = item.category === 'r18' ? 'is-r18-media' : '';

      const visibleOffers = getVisibleOffers(item);
      const storeSummary = STORE_ORDER.map((storeId) => {
        const offers = visibleOffers.filter((o) => o.store === storeId);
        if (!offers.length) return null;
        const specialOffers = offers.filter((o) => o.hasStoreExclusiveBonus === true);
        return {
          store: STORES[storeId],
          total: offers.length,
          specialCount: specialOffers.length,
        };
      }).filter(Boolean);

      const includedHtml = (item.includedBonuses || []).length
        ? `<div class="included-strip">${escapeHtml(item.includedBonuses[0].label)}</div>`
        : '';

      const stripHtml =
        photos.length > 1 || pressCount > 0
          ? `<div class="card-photo-strip" aria-label="関連写真プレビュー">
              ${photos
                .slice(0, 5)
                .map(
                  (photo, pIdx) => `
                  <button
                    class="strip-thumb-btn ${r18Class}"
                    type="button"
                    data-item-lightbox="${escapeHtml(item.id)}"
                    data-photo-idx="${pIdx}"
                    title="${escapeHtml(photo.caption)}"
                  >${renderPhotoImg(photo)}</button>
                `
                )
                .join('')}
              <button class="strip-count-pill" type="button" data-quick-preview="${escapeHtml(item.id)}">
                🔍 ワンタップ確認（${photos.length}枚${pressCount ? `＋記事${pressCount}` : ''}）
              </button>
            </div>`
          : '';

      return `
        <article class="mag-card ${oshiHits.length ? 'oshi-match' : ''} ${
        fullySkipped ? 'is-skipped' : ''
      }">
          <div class="mag-card-top" data-open-id="${escapeHtml(item.id)}">
            <div class="cover-wrap ${r18Class}">
              ${renderCoverImg(item)}
              <span class="cover-date-tag ${cd.type === 'today' ? 'is-today' : ''}">
                ${escapeHtml(item.releaseDate.slice(5).replace('-', '/'))} ・ ${escapeHtml(cd.text)}
              </span>
            </div>

            <div class="mag-info">
              <div class="meta-top-row">
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${item.autoDiscovered ? `<span class="new-auto-badge">🆕 自動発見</span>` : ''}
                  <span class="cat-badge ${item.category === 'r18' ? 'is-r18' : ''}">${escapeHtml(CATEGORY_META[item.category]?.label || '雑誌')}</span>
                  ${
                    watch.bonusCount > 0
                      ? watch.pendingBonusCount === 0
                        ? `<span class="art-watch-badge is-revealed">✨ 絵柄公開済</span>`
                        : `<span class="art-watch-badge is-pending">⏳ 絵柄待ち${watch.pendingBonusCount}</span>`
                      : ''
                  }
                  ${oshiHits.length ? `<span class="oshi-badge">🔥 ${escapeHtml(oshiHits[0])}</span>` : ''}
                </div>
                ${renderStatusMarkButton(item, false)}
              </div>

              <h2 class="mag-title">${escapeHtml(item.title)}</h2>
              <p class="mag-talents">${escapeHtml((item.coverTalents || []).join(' / '))}</p>

              <div class="bonus-row">
                ${bonusTypes
                  .slice(0, 4)
                  .map((bt) => {
                    const meta = BONUS_TYPE_META[bt] || { icon: '🎁', label: bt };
                    const extraClass =
                      bt === 'poster'
                        ? 'is-poster'
                        : bt === 'cover'
                          ? 'is-cover'
                          : bt === 'signed'
                            ? 'is-signed'
                            : '';
                    return `<span class="bonus-pill ${extraClass}">${meta.icon} ${escapeHtml(meta.label)}</span>`;
                  })
                  .join('')}
              </div>
            </div>
          </div>

          ${stripHtml}

          <div class="mag-card-footer">
            ${includedHtml}
            <div class="store-pills-row">
              <div class="store-chips">
                ${storeSummary
                  .map(
                    (s) => `
                  <span class="store-badge ${s.store.badgeClass}">
                    ${escapeHtml(s.store.shortName)}${s.specialCount > 0 ? ` 特典${s.specialCount}` : ''}
                  </span>
                `
                  )
                  .join('')}
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0;">
                <button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">
                  🔍 確認
                </button>
                <button class="detail-trigger-btn" type="button" data-open-id="${escapeHtml(item.id)}">
                  比較・購入
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

/* =========================================================
   Tab 2: Urgent Pre-Order & Sell-Out Radar
   ========================================================= */
function updateUrgentNavBadge(unreservedSACount) {
  const badge = document.getElementById('urgentNavBadge');
  if (!badge) return;
  if (unreservedSACount > 0) {
    badge.textContent = unreservedSACount > 99 ? '99+' : String(unreservedSACount);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderUrgentRadar() {
  const container = document.getElementById('urgentRadarContainer');
  const allRadar = getUrgentRadarItems(getAllItems(), {
    referenceDate: state.referenceDate,
    oshiKeywords: state.oshiKeywords,
    vipTalents: state.vipTalents,
    oshiBoostMode: state.oshiBoostMode,
    minScore: 30,
  });

  const activeUnreserved = allRadar.filter(
    ({ item }) => !isItemSecured(item) && !isItemFullySkipped(item)
  );
  const securedList = allRadar.filter(({ item }) => isItemSecured(item));

  const countS = activeUnreserved.filter((e) => e.scarcity.rank === 'S').length;
  const countA = activeUnreserved.filter((e) => e.scarcity.rank === 'A').length;
  const countB = activeUnreserved.filter((e) => e.scarcity.rank === 'B').length;
  const countSecured = securedList.length;

  updateUrgentNavBadge(countS + countA);
  if (!container) return;

  // Apply rank / secured + unreservedOnly + topic filters
  let filtered = allRadar.filter(({ item, scarcity }) => {
    const secured = isItemSecured(item);
    const skipped = isItemFullySkipped(item);

    if (state.urgentRankFilter === 'secured') {
      if (!secured) return false;
    } else {
      if (state.urgentUnreservedOnly && (secured || skipped)) return false;
      if (state.urgentRankFilter !== 'all' && scarcity.rank !== state.urgentRankFilter) {
        return false;
      }
    }

    if (state.urgentTopicFilter === 'auto' && !item.autoDiscovered) return false;
    if (state.urgentTopicFilter === 'limited' && !scarcity.hasSignedOrLimited) return false;
    if (state.urgentTopicFilter === 'cover' && !scarcity.hasExclusiveCover) return false;
    if (state.urgentTopicFilter === 'oshi' && !scarcity.hasOshiHit) return false;
    if (state.urgentTopicFilter === 'r18' && item.category !== 'r18') return false;
    if (state.urgentTopicFilter === 'calendar' && !scarcity.isCalendarTitle) return false;
    return true;
  });

  const autoRadarCount = activeUnreserved.filter(({ item }) => Boolean(item.autoDiscovered)).length;
  const topicChoices = [
    { id: 'all', label: '🔥 すべて' },
    { id: 'auto', label: `🆕 自動発見 (${autoRadarCount})` },
    { id: 'limited', label: '💎 部数・サイン・数量限' },
    { id: 'cover', label: '✨ ストア限定表紙' },
    { id: 'oshi', label: '💖 推し・VIPヒット' },
    { id: 'r18', label: '🔞 R18争奪' },
    { id: 'calendar', label: '🗓 カレンダー' },
  ];

  const kpiHtml = `
    <div class="urgent-summary-grid" role="group" aria-label="売り切れ警戒ランク絞り込み">
      <button class="urgent-kpi-btn kpi-s ${state.urgentRankFilter === 'S' ? 'active' : ''}" type="button" data-urgent-rank="${state.urgentRankFilter === 'S' ? 'all' : 'S'}">
        <span class="urgent-kpi-label">🔴 Sランク・即予約</span>
        <span class="urgent-kpi-num">${countS}</span>
        <span class="urgent-kpi-sub">未予約の超警戒枠</span>
      </button>
      <button class="urgent-kpi-btn kpi-a ${state.urgentRankFilter === 'A' ? 'active' : ''}" type="button" data-urgent-rank="${state.urgentRankFilter === 'A' ? 'all' : 'A'}">
        <span class="urgent-kpi-label">🟠 Aランク・早め確保</span>
        <span class="urgent-kpi-num">${countA}</span>
        <span class="urgent-kpi-sub">発売日前に確保推奨</span>
      </button>
      <button class="urgent-kpi-btn kpi-b ${state.urgentRankFilter === 'B' ? 'active' : ''}" type="button" data-urgent-rank="${state.urgentRankFilter === 'B' ? 'all' : 'B'}">
        <span class="urgent-kpi-label">🟡 Bランク・注目枠</span>
        <span class="urgent-kpi-num">${countB}</span>
        <span class="urgent-kpi-sub">動向＆絵柄ウォッチ</span>
      </button>
      <button class="urgent-kpi-btn kpi-ok ${state.urgentRankFilter === 'secured' ? 'active' : ''}" type="button" data-urgent-rank="${state.urgentRankFilter === 'secured' ? 'all' : 'secured'}">
        <span class="urgent-kpi-label">✅ 確保済み</span>
        <span class="urgent-kpi-num">${countSecured}</span>
        <span class="urgent-kpi-sub">予約済・購入済</span>
      </button>
    </div>
  `;

  const boostPillsHtml = Object.values(OSHI_BOOST_PRESETS)
    .map(
      (p) => `
      <button
        class="urgent-boost-mini ${state.oshiBoostMode === p.id ? 'active' : ''}"
        type="button"
        data-set-oshi-boost="${p.id}"
        title="${escapeHtml(p.desc)}"
      >${escapeHtml(p.shortLabel)}</button>
    `
    )
    .join('');

  const toolbarHtml = `
    <div class="urgent-toolbar">
      <div class="urgent-toolbar-top">
        <div class="urgent-count-text">
          ${
            state.urgentRankFilter === 'secured'
              ? `✅ 確保済み <strong>${filtered.length}</strong>件`
              : `🚨 要チェック <strong>${filtered.length}</strong>件（全${allRadar.length}件中）`
          }
        </div>
        <label class="toggle-inline">
          <input
            type="checkbox"
            data-urgent-unreserved-toggle
            ${state.urgentUnreservedOnly ? 'checked' : ''}
            ${state.urgentRankFilter === 'secured' ? 'disabled' : ''}
          />
          <span>🚨 未予約のみ表示</span>
        </label>
      </div>
      <div class="urgent-boost-strip">
        <div class="urgent-boost-pills">
          <span style="font-size:10px;font-weight:900;color:var(--ink-secondary);">🚀 推し加点:</span>
          ${boostPillsHtml}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <button class="quick-preview-icon-btn" type="button" data-jump-isbn-import="1">
            ⚡ URL/ISBN取込
          </button>
          <button class="quick-preview-icon-btn" type="button" data-jump-oshi-corner="1">
            💖 推し・👑VIP (${state.oshiKeywords.length}${state.vipTalents.length ? `/👑${state.vipTalents.length}` : ''}) →
          </button>
        </div>
      </div>
      <div class="chip-scroll" style="padding-top:0;">
        ${topicChoices
          .map(
            (c) => `
          <button
            class="filter-chip ${state.urgentTopicFilter === c.id ? 'active' : ''}"
            type="button"
            data-urgent-topic="${c.id}"
          >${escapeHtml(c.label)}</button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  const cardsHtml = filtered.length
    ? `<div class="urgent-list">
        ${filtered
          .map(({ item, scarcity }) => {
            const cd = formatCountdown(item.releaseDate);
            const secured = isItemSecured(item);
            const r18Class = item.category === 'r18' ? 'is-r18-media' : '';
            const catMeta = CATEGORY_META[item.category] || { label: '雑誌' };
            const primaryHotOffer = scarcity.hotOffers[0] || getVisibleOffers(item)[0] || null;
            const visibleCount = getVisibleOffers(item).length;

            const reasonsHtml = scarcity.reasons
              .slice(0, 5)
              .map(
                (r) => `
              <span class="urgent-reason-pill tone-${r.tone}">
                ${r.icon} ${escapeHtml(r.label)}${r.points > 0 ? ` +${r.points}` : ''}
              </span>
            `
              )
              .join('');

            const buyButtonsHtml = scarcity.hotOffers
              .map((offer) => {
                const st = STORES[offer.store] || { shortName: offer.store, name: offer.store };
                const isBonus = offer.hasStoreExclusiveBonus === true;
                const actionWord =
                  offer.status === 'available'
                    ? '在庫確認'
                    : offer.status === 'forecast'
                      ? '解禁確認'
                      : '即予約';
                const editionHint = (offer.bonusTypes || []).includes('signed')
                  ? 'サイン本'
                  : (offer.bonusTypes || []).includes('cover')
                    ? '限定表紙'
                    : isBonus
                      ? '限定特典'
                      : 'Amazon';
                return `
                  <a
                    class="urgent-buy-btn store-${escapeHtml(offer.store)}"
                    href="${escapeHtml(offer.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-stop-prop="1"
                    title="${escapeHtml(offer.edition)} — ${escapeHtml(offer.bonusText || '')}"
                  >🛒 ${escapeHtml(st.shortName)}（${escapeHtml(editionHint)}）${actionWord} ↗</a>
                `;
              })
              .join('');

            const quickReserveBtn = secured
              ? `<span class="urgent-secured-pill">✅ 確保済み</span>`
              : primaryHotOffer
                ? `<button
                    class="urgent-mark-reserved-btn"
                    type="button"
                    data-quick-reserve-item="${escapeHtml(item.id)}"
                    data-quick-reserve-offer="${escapeHtml(primaryHotOffer.id)}"
                    title="この最優先版をワンタップで「🛒 予約済」に記録"
                  >✓ 予約済にする</button>`
                : '';

            return `
              <article class="urgent-card ${scarcity.rankMeta.colorClass} ${secured ? 'is-secured' : ''}">
                <div class="urgent-card-main">
                  <div class="urgent-cover-wrap ${r18Class}" data-quick-preview="${escapeHtml(item.id)}" title="タップして表紙＆特典写真を確認">
                    ${renderCoverImg(item)}
                    <span class="urgent-cover-cat ${item.category === 'r18' ? 'is-r18' : ''}">
                      ${item.category === 'r18' ? '🔞R18' : escapeHtml(catMeta.label.replace(/^[^\s]+\s/, ''))}
                    </span>
                  </div>
                  <div class="urgent-info">
                    <div class="urgent-rank-row">
                      <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                        <span class="urgent-rank-badge ${scarcity.rankMeta.colorClass}">
                          ${escapeHtml(scarcity.rankMeta.badge)}
                        </span>
                        ${item.autoDiscovered ? `<span class="new-auto-badge">🆕 自動発見</span>` : ''}
                      </div>
                      <span class="urgent-score-meter" title="売り切れ警戒スコア ${scarcity.score}/100">
                        <span class="urgent-score-track">
                          <span class="urgent-score-fill ${scarcity.rankMeta.colorClass}" style="width:${scarcity.score}%"></span>
                        </span>
                        <span>${scarcity.score}pt</span>
                      </span>
                    </div>

                    <h3 class="urgent-title" data-open-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</h3>
                    <div class="urgent-meta-line">
                      <span class="urgent-date-pill">${escapeHtml(formatDateLabel(item.releaseDate))}（${escapeHtml(cd.text)}）</span>
                      <span>${escapeHtml((item.coverTalents || []).join(' / '))}</span>
                      <span>¥${(item.price || 0).toLocaleString()}</span>
                    </div>

                    <div class="urgent-reasons">${reasonsHtml}</div>
                  </div>
                </div>

                <div class="urgent-action-strip">
                  <div class="urgent-preorder-links">${buyButtonsHtml}</div>
                  <div class="urgent-secondary-actions">
                    ${quickReserveBtn}
                    <button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">🔍 確認</button>
                    <button class="quick-preview-icon-btn" type="button" data-open-status-picker="${escapeHtml(item.id)}">🏷 版別</button>
                    ${
                      visibleCount > 1
                        ? `<button class="detail-trigger-btn" type="button" data-open-id="${escapeHtml(item.id)}">全${visibleCount}版比較</button>`
                        : `<button class="detail-trigger-btn" type="button" data-open-id="${escapeHtml(item.id)}">詳細</button>`
                    }
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>`
    : `<div class="empty-state">
        <strong>${
          state.urgentRankFilter === 'secured'
            ? 'まだ確保済みの争奪タイトルはありません'
            : 'この条件の未予約アラートはすべてクリア済みです！🎉'
        }</strong>
        <p>${
          state.urgentRankFilter === 'secured'
            ? '気になる注目作を予約したら「✓ 予約済にする」をタップして管理しましょう。'
            : 'フィルターを「すべて」に戻すか、「未予約のみ表示」をオフにすると確保済みも確認できます。'
        }</p>
      </div>`;

  const securedBannerHtml =
    state.urgentRankFilter !== 'secured' && state.urgentUnreservedOnly && countSecured > 0
      ? `<div class="urgent-secured-banner">
          <span>✅ <strong>${countSecured}件</strong>の争奪注目作はすでに予約済／購入済です！</span>
          <button class="quick-preview-icon-btn" type="button" data-urgent-rank="secured">確保済みを見る →</button>
        </div>`
      : '';

  container.innerHTML = kpiHtml + toolbarHtml + cardsHtml + securedBannerHtml;
}

/* =========================================================
   Monthly Oshi Budget Meter (Proposal 3)
   ========================================================= */
function renderMonthlyBudgetMeterHtml() {
  const budget = Math.max(1000, Number(state.monthlyBudget) || 15000);
  const allMarked = getAllMarkedEntries();
  const months = [
    { id: '2026-11', label: '2026年11月（今月）' },
    { id: '2026-12', label: '2026年12月（来月）' },
    { id: '2027-01', label: '2027年1月（2ヶ月先）' },
    { id: '2027-02', label: '2027年2月（3ヶ月先）' },
  ];

  const rowsHtml = months
    .map((m) => {
      const mEntries = allMarked.filter((e) => (e.item.releaseDate || '').startsWith(m.id));
      const confirmed = mEntries
        .filter((e) => e.status === 'want' || e.status === 'reserved' || e.status === 'owned')
        .reduce((sum, e) => sum + e.price, 0);
      const confirmedCnt = mEntries.filter(
        (e) => e.status === 'want' || e.status === 'reserved' || e.status === 'owned'
      ).length;
      const considering = mEntries
        .filter((e) => e.status === 'considering')
        .reduce((sum, e) => sum + e.price, 0);
      const consideringCnt = mEntries.filter((e) => e.status === 'considering').length;

      const total = confirmed + considering;
      const confirmedPct = Math.min(100, Math.round((confirmed / budget) * 100));
      const consideringPct = Math.min(100 - confirmedPct, Math.round((considering / budget) * 100));
      const remaining = budget - confirmed;

      const statusTag =
        remaining < 0
          ? `<span class="budget-over-tag">⚠️ 予算超過 +¥${Math.abs(remaining).toLocaleString()}</span>`
          : `<span class="budget-ok-tag">残り ¥${remaining.toLocaleString()}</span>`;

      return `
        <div class="budget-month-row">
          <div class="budget-month-top">
            <span>${escapeHtml(m.label)}</span>
            ${statusTag}
          </div>
          <div class="budget-bar-track" aria-label="${escapeHtml(m.label)}予算消化率">
            <div class="budget-bar-confirmed ${remaining >= 0 ? 'is-safe' : ''}" style="width:${confirmedPct}%"></div>
            <div class="budget-bar-considering" style="width:${consideringPct}%"></div>
          </div>
          <div class="budget-month-foot">
            <span>確定・予定(${confirmedCnt}版): <strong>¥${confirmed.toLocaleString()}</strong></span>
            <span>${consideringCnt > 0 ? `🤔検討(${consideringCnt}版): ¥${considering.toLocaleString()}` : total === 0 ? 'まだ予定なし' : '検討中なし'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="budget-meter-card">
      <div class="budget-meter-head">
        <h3 class="budget-meter-title">💰 月別 推し活予算メーター（版別金額で自動集計）</h3>
        <label class="budget-input-group">
          <span>月予算 ¥</span>
          <input
            class="budget-number-input"
            type="number"
            min="1000"
            step="1000"
            value="${budget}"
            data-budget-input
            aria-label="月あたりの推し活予算上限"
          />
        </label>
      </div>
      <div class="budget-presets">
        ${BUDGET_PRESETS.map(
          (val) => `
          <button
            class="budget-preset-btn ${budget === val ? 'active' : ''}"
            type="button"
            data-budget-preset="${val}"
          >¥${val.toLocaleString()}</button>
        `
        ).join('')}
      </div>
      <div class="budget-months-grid">${rowsHtml}</div>
    </div>
  `;
}

function setMonthlyBudget(val) {
  const num = Math.max(1000, Math.min(500000, Math.round(Number(val) || 15000)));
  state.monthlyBudget = num;
  saveJson(STORAGE_KEYS.budget, num);
  renderCalendar();
  renderOshiAndShelf();
}

/* =========================================================
   Tab 2: 3-Month Upcoming Excitement Corner
   ========================================================= */
function getMonthRoadmapBuckets(items) {
  const upcomingItems = items.filter((it) => diffDays(it.releaseDate) >= 0);
  const pastItems = items.filter((it) => diffDays(it.releaseDate) < 0);
  const allMarked = getAllMarkedEntries();

  const buckets = [
    { id: 'upcoming', tag: '今後3ヶ月', title: '✨ すべて', items: upcomingItems },
    {
      id: '2026-11',
      tag: '今月',
      title: '11月',
      items: upcomingItems.filter((it) => it.releaseDate.startsWith('2026-11')),
    },
    {
      id: '2026-12',
      tag: '来月',
      title: '12月',
      items: upcomingItems.filter((it) => it.releaseDate.startsWith('2026-12')),
    },
    {
      id: '2027-01',
      tag: '2ヶ月先',
      title: '2027年1月',
      items: upcomingItems.filter((it) => it.releaseDate.startsWith('2027-01')),
    },
    {
      id: '2027-02',
      tag: '3ヶ月先',
      title: '2027年2月',
      items: upcomingItems.filter((it) => it.releaseDate.startsWith('2027-02')),
    },
    { id: 'past', tag: 'アーカイブ', title: '発売済', items: pastItems },
  ];

  return buckets.map((b) => {
    const idSet = new Set(b.items.map((x) => x.id));
    const bucketEntries = allMarked.filter((e) => idSet.has(e.item.id));
    const bonusCount = b.items.filter((it) => getItemSpecialBonusCount(it) > 0).length;
    const plannedEntries = bucketEntries.filter(
      (e) => e.status === 'want' || e.status === 'reserved' || e.status === 'owned'
    );
    const consideringCount = bucketEntries.filter((e) => e.status === 'considering').length;
    const plannedYen = plannedEntries.reduce((sum, e) => sum + e.price, 0);
    return {
      ...b,
      bonusCount,
      plannedCount: plannedEntries.length,
      consideringCount,
      plannedYen,
    };
  });
}

function getUpcomingPlannedEntries() {
  return getAllMarkedEntries()
    .filter(
      (e) =>
        diffDays(e.item.releaseDate) >= 0 &&
        (e.status === 'want' || e.status === 'reserved' || e.status === 'considering')
    )
    .sort((a, b) => new Date(a.item.releaseDate) - new Date(b.item.releaseDate));
}

function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const allItems = getAllItems();
  const buckets = getMonthRoadmapBuckets(allItems);

  const upcomingSorted = allItems
    .filter((it) => diffDays(it.releaseDate) >= 0 && !isItemFullySkipped(it))
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

  const heroItem =
    upcomingSorted.find((it) => {
      const s = getItemStatusSummary(it);
      return s.primaryStatus && s.primaryStatus !== 'skip';
    }) ||
    upcomingSorted.find((it) => getItemSpecialBonusCount(it) > 0) ||
    upcomingSorted[0] ||
    null;

  let heroHtml = '';
  if (heroItem) {
    const cd = formatCountdown(heroItem.releaseDate);
    const summary = getItemStatusSummary(heroItem);
    const stText = summary.primaryStatus ? SHELF_STATUS_META[summary.primaryStatus].label : '🎁 注目リリース';
    const topBonus =
      summary.markedOffers[0]
        ? `${formatOfferShortLabel(summary.markedOffers[0].offer)}：${summary.markedOffers[0].offer.bonusText}`
        : getVisibleOffers(heroItem).find((o) => o.hasStoreExclusiveBonus === true)?.bonusText ||
          heroItem.includedBonuses?.[0]?.label ||
          heroItem.summary ||
          '';
    const r18Class = heroItem.category === 'r18' ? 'is-r18-media' : '';
    heroHtml = `
      <div class="excitement-hero">
        <div class="${r18Class}" style="flex-shrink:0;border-radius:10px;">
          ${renderCoverImg(heroItem, 'excitement-hero-thumb')}
        </div>
        <div class="excitement-hero-body">
          <div class="excitement-hero-kicker">
            <span>💖 次のお楽しみ</span>
            <span>・</span>
            <span>${escapeHtml(formatDateLabel(heroItem.releaseDate))}（${escapeHtml(cd.text)}）</span>
            <span>・</span>
            <span>${escapeHtml(stText)}</span>
          </div>
          <h3 class="excitement-hero-title">${escapeHtml(heroItem.title)}</h3>
          <p class="excitement-hero-sub">${escapeHtml(topBonus)}</p>
          <div class="excitement-hero-actions">
            <button class="excitement-hero-btn" type="button" data-quick-preview="${escapeHtml(heroItem.id)}">
              🔍 ワンタップ確認
            </button>
            <button class="excitement-hero-btn is-ghost" type="button" data-open-id="${escapeHtml(heroItem.id)}">
              特典比較・購入 →
            </button>
            <button class="excitement-hero-btn is-ghost" type="button" data-download-ics="${escapeHtml(heroItem.id)}">
              📅 この作品を登録
            </button>
          </div>
        </div>
      </div>
    `;
  }

  const upcomingPlanned = getUpcomingPlannedEntries();
  const bulkBarHtml = `
    <div class="shelf-actions-bar" style="margin-top:0;">
      <span style="font-size:11px;font-weight:700;color:var(--ink-secondary);">
        📌 発売予定のマーク済み：<strong>${upcomingPlanned.length}版</strong>
      </span>
      <button
        class="bulk-ics-btn"
        type="button"
        data-download-bulk-ics="upcoming"
        ${upcomingPlanned.length === 0 ? 'disabled' : ''}
      >📅 予定・予約済みをまとめてカレンダー登録 (${upcomingPlanned.length}件)</button>
    </div>
  `;

  const budgetHtml = renderMonthlyBudgetMeterHtml();

  const roadmapHtml = `
    <div class="month-roadmap-strip" role="tablist" aria-label="月別発売ロードマップ">
      ${buckets
        .map(
          (b) => `
        <button
          class="month-pill-card ${state.calendarMonth === b.id ? 'active' : ''}"
          type="button"
          data-cal-month="${b.id}"
        >
          <span class="month-pill-tag">${escapeHtml(b.tag)}</span>
          <span class="month-pill-title">${escapeHtml(b.title)}</span>
          <span class="month-pill-stats">${b.items.length}作品 ・ 🎁${b.bonusCount}</span>
          <span class="month-pill-budget">${
            b.plannedCount > 0
              ? `👀${b.plannedCount}版 ¥${b.plannedYen.toLocaleString()}`
              : b.consideringCount > 0
                ? `🤔検討中 ${b.consideringCount}版`
                : 'まだ未マーク'
          }</span>
        </button>
      `
        )
        .join('')}
    </div>
  `;

  const subChoices = [
    { id: 'all', label: 'すべて表示' },
    { id: 'marked', label: '💖 予定・検討中のみ' },
    { id: 'bonus', label: '🎁 限定特典あり' },
    { id: 'pending', label: '⏳ 絵柄解禁待ち' },
    { id: 'calendar', label: '🗓 カレンダー' },
    { id: 'photobook', label: '📸 写真集' },
    { id: 'r18', label: '🔞 R18' },
  ];
  const subFilterHtml = `
    <div class="calendar-subfilter-row">
      ${subChoices
        .map(
          (c) => `
        <button
          class="filter-chip ${state.calendarSubFilter === c.id ? 'active' : ''}"
          type="button"
          data-cal-sub="${c.id}"
        >${escapeHtml(c.label)}</button>
      `
        )
        .join('')}
    </div>
  `;

  const selectedBucket = buckets.find((b) => b.id === state.calendarMonth) || buckets[0];
  let listItems = [...selectedBucket.items];

  if (state.calendarSubFilter === 'marked') {
    listItems = listItems.filter((it) => {
      const s = getItemStatusSummary(it);
      return s.activeCount > 0;
    });
  } else if (state.calendarSubFilter === 'bonus') {
    listItems = listItems.filter((it) => getItemSpecialBonusCount(it) > 0);
  } else if (state.calendarSubFilter === 'pending') {
    listItems = listItems.filter((it) => getItemArtworkWatch(it).hasPendingWatch);
  } else if (state.calendarSubFilter === 'calendar') {
    listItems = listItems.filter((it) => it.category === 'calendar');
  } else if (state.calendarSubFilter === 'photobook') {
    listItems = listItems.filter((it) => it.category === 'photobook');
  } else if (state.calendarSubFilter === 'r18') {
    listItems = listItems.filter((it) => it.category === 'r18');
  }

  listItems.sort((a, b) =>
    state.calendarMonth === 'past'
      ? new Date(b.releaseDate) - new Date(a.releaseDate)
      : new Date(a.releaseDate) - new Date(b.releaseDate)
  );

  const grouped = new Map();
  for (const item of listItems) {
    if (!grouped.has(item.releaseDate)) grouped.set(item.releaseDate, []);
    grouped.get(item.releaseDate).push(item);
  }

  const timelineHtml = grouped.size
    ? [...grouped.entries()]
        .map(([dateStr, list]) => {
          const cd = formatCountdown(dateStr);
          return `
            <section class="calendar-section">
              <div class="calendar-date-header">
                <h3 class="calendar-date-title">${escapeHtml(formatDateLabel(dateStr))}</h3>
                <span class="calendar-countdown ${cd.type}">${escapeHtml(cd.text)}</span>
              </div>
              <div class="timeline-list">
                ${list
                  .map((item) => {
                    const specialCount = getItemSpecialBonusCount(item);
                    const photoCount = getItemPhotos(item).length;
                    const fullySkipped = isItemFullySkipped(item);
                    const watch = getItemArtworkWatch(item);
                    const catLabel = CATEGORY_META[item.category]?.label || '雑誌';
                    const r18Class = item.category === 'r18' ? 'is-r18-media' : '';
                    return `
                      <div class="timeline-item ${fullySkipped ? 'is-skipped' : ''}" data-open-id="${escapeHtml(item.id)}">
                        <div class="${r18Class}" style="flex-shrink:0;border-radius:8px;">
                          ${renderCoverImg(item, 'timeline-thumb')}
                        </div>
                        <div class="timeline-body">
                          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:3px;">
                            ${item.autoDiscovered ? `<span class="new-auto-badge">🆕 自動発見</span>` : ''}
                            <span class="cat-badge ${item.category === 'r18' ? 'is-r18' : ''}">${escapeHtml(catLabel)}</span>
                            ${
                              specialCount > 0
                                ? `<span class="oshi-badge">🎁 特典${specialCount}</span>`
                                : ''
                            }
                            ${
                              watch.bonusCount > 0
                                ? watch.pendingBonusCount === 0
                                  ? `<span class="art-watch-badge is-revealed">✨ 絵柄公開</span>`
                                  : `<span class="art-watch-badge is-pending">⏳ 絵柄待${watch.pendingBonusCount}</span>`
                                : ''
                            }
                          </div>
                          <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
                          <p class="timeline-sub">
                            ${escapeHtml((item.coverTalents || []).join('・'))}
                            ／ ¥${(item.price || 0).toLocaleString()} ・ 📷${photoCount}枚
                          </p>
                        </div>
                        <div class="timeline-actions">
                          ${renderStatusMarkButton(item, false)}
                          <button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">
                            🔍 確認
                          </button>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </section>
          `;
        })
        .join('')
    : `<div class="empty-state"><strong>この条件の発売予定はありません</strong><p>別の月や絞り込みを切り替えてみてください。</p></div>`;

  container.innerHTML = `${heroHtml}${bulkBarHtml}${budgetHtml}${roadmapHtml}${subFilterHtml}${timelineHtml}`;
}

/* =========================================================
   Tab 4: 💖 Oshi Corner (1-Tap Palette & VIP) + Per-Edition Shelf
   ========================================================= */
function switchOshiSubTab(subTab) {
  state.oshiSubTab = subTab;
  const subNav = document.getElementById('oshiSubNav');
  if (subNav) {
    subNav.querySelectorAll('[data-oshi-subtab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.oshiSubtab === subTab);
    });
  }
  const map = {
    oshi: 'oshiPaneOshi',
    shelf: 'oshiPaneShelf',
    tools: 'oshiPaneTools',
  };
  for (const [k, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', k === subTab);
  }
}

function renderOshiCorner() {
  // 1. Oshi Boost 3-step selector
  const boostSeg = document.getElementById('oshiBoostSegment');
  if (boostSeg) {
    boostSeg.innerHTML = Object.values(OSHI_BOOST_PRESETS)
      .map(
        (p) => `
        <button
          class="oshi-boost-btn ${state.oshiBoostMode === p.id ? 'active' : ''}"
          type="button"
          data-set-oshi-boost="${p.id}"
          title="${escapeHtml(p.desc)}"
        >${escapeHtml(p.label)}</button>
      `
      )
      .join('');
  }

  // 2. Registered Oshi keywords (with 1-tap VIP crown promote toggle)
  const cloud = document.getElementById('oshiTagCloud');
  if (cloud) {
    cloud.innerHTML = state.oshiKeywords.length
      ? state.oshiKeywords
          .map((kw) => {
            const isVip = state.vipTalents.includes(kw);
            return `
            <span class="oshi-tag ${isVip ? 'is-vip-tag' : ''}">
              <span>${isVip ? '👑' : '💖'} ${escapeHtml(kw)}</span>
              <button
                class="oshi-tag-vip-btn ${isVip ? 'active' : ''}"
                type="button"
                data-toggle-vip="${escapeHtml(kw)}"
                title="${isVip ? 'VIP超人気枠から外す' : '👑 Sランク超人気VIP枠(+30pt)へ昇格'}"
              >👑${isVip ? 'VIP中' : 'VIP'}</button>
              <button type="button" data-remove-oshi="${escapeHtml(kw)}" aria-label="${escapeHtml(kw)}を削除">×</button>
            </span>
          `;
          })
          .join('')
      : '<span style="font-size:12px;color:var(--ink-muted);">下の人気タレント一覧からタップするだけで簡単に登録できます！</span>';
  }

  // 3. Custom S-Rank VIP Talents (+30pt)
  const vipCloud = document.getElementById('vipTagCloud');
  if (vipCloud) {
    vipCloud.innerHTML = state.vipTalents.length
      ? state.vipTalents
          .map(
            (kw) => `
            <span class="oshi-tag is-vip-tag">
              <span>👑 ${escapeHtml(kw)}（+30pt）</span>
              <button type="button" data-toggle-vip="${escapeHtml(kw)}" aria-label="${escapeHtml(kw)}をVIPから解除">×</button>
            </span>
          `
          )
          .join('')
      : '<span style="font-size:11px;color:var(--ink-muted);">まだ未登録です。推しや下のパレットの「👑」を押すと、その女優・アイドルが Sランク超人気枠（+30pt）に入ります！</span>';
  }

  // 4. 1-Tap Popular Talent Registration Palette
  const paletteGroups = [
    { id: 'all', label: '✨ すべて' },
    { id: 'idol', label: '🎤 アイドル' },
    { id: 'gravure', label: '👙 グラビア' },
    { id: 'r18', label: '🔞 R18女優' },
    { id: 'bonus', label: '🎁 特典ワード' },
  ];
  const groupTabs = document.getElementById('paletteGroupTabs');
  if (groupTabs) {
    groupTabs.innerHTML = paletteGroups
      .map((g) => {
        const cnt =
          g.id === 'all'
            ? POPULAR_TALENT_PRESETS.length
            : POPULAR_TALENT_PRESETS.filter((p) => p.group === g.id).length;
        return `
          <button
            class="filter-chip ${state.paletteGroup === g.id ? 'active' : ''}"
            type="button"
            data-palette-group="${g.id}"
          >${escapeHtml(g.label)} (${cnt})</button>
        `;
      })
      .join('');
  }

  const paletteGrid = document.getElementById('popularTalentPalette');
  if (paletteGrid) {
    const pq = state.paletteSearch.trim().toLowerCase();
    const filteredPresets = POPULAR_TALENT_PRESETS.filter((p) => {
      if (state.paletteGroup !== 'all' && p.group !== state.paletteGroup) return false;
      if (pq && !`${p.name} ${p.tag}`.toLowerCase().includes(pq)) return false;
      return true;
    });

    paletteGrid.innerHTML = filteredPresets.length
      ? filteredPresets
          .map((p) => {
            const isOshi = state.oshiKeywords.includes(p.name);
            const isVip = state.vipTalents.includes(p.name);
            const hits = countItemsMatchingKeyword(p.name);
            return `
              <div class="talent-pick-item ${isOshi ? 'is-oshi' : ''} ${isVip ? 'is-vip' : ''}">
                <button
                  class="talent-pick-main"
                  type="button"
                  data-toggle-oshi="${escapeHtml(p.name)}"
                  aria-pressed="${isOshi ? 'true' : 'false'}"
                  title="${isOshi ? 'タップで推し解除' : 'タップで💖推し登録'}"
                >
                  <span class="talent-pick-name">${isOshi ? '💖 ' : '＋ '}${escapeHtml(p.name)}</span>
                  <span class="talent-pick-sub">
                    <span>${escapeHtml(p.tag)}</span>
                    ${hits > 0 ? `<span class="talent-pick-count">${hits}件</span>` : ''}
                  </span>
                </button>
                <button
                  class="talent-pick-vip-btn ${isVip ? 'active' : ''}"
                  type="button"
                  data-toggle-vip="${escapeHtml(p.name)}"
                  aria-pressed="${isVip ? 'true' : 'false'}"
                  title="${isVip ? '👑 VIP超人気枠から外す' : '👑 Sランク超人気VIP枠(+30pt)に追加'}"
                >👑</button>
              </div>
            `;
          })
          .join('')
      : '<p style="font-size:12px;color:var(--ink-muted);grid-column:1/-1;margin:4px 0;">該当する名前がありません。上の自由入力からそのまま追加できます！</p>';
  }

  // 5. Live Oshi-Hit Releases Feed
  const oshiHitItems = getAllItems()
    .filter((item) => itemMatchesOshi(item).length > 0 && !isItemFullySkipped(item))
    .sort((a, b) => {
      const da = diffDays(a.releaseDate);
      const db = diffDays(b.releaseDate);
      const aUp = da >= 0 ? 0 : 1;
      const bUp = db >= 0 ? 0 : 1;
      if (aUp !== bUp) return aUp - bUp;
      return aUp === 0 ? da - db : db - da;
    });

  const hitsHeading = document.getElementById('oshiHitsHeading');
  if (hitsHeading) {
    hitsHeading.textContent = `💖 あなたの推しヒット作品（${oshiHitItems.length}件）`;
  }

  const hitsFeed = document.getElementById('oshiHitsFeed');
  if (hitsFeed) {
    if (!oshiHitItems.length) {
      hitsFeed.innerHTML =
        '<p style="font-size:12px;color:var(--ink-muted);margin:0;">上の人気タレント名をタップして登録すると、ここにあなたの推し作品がずらっと集まります！</p>';
    } else {
      hitsFeed.innerHTML = oshiHitItems
        .slice(0, 14)
        .map((item) => {
          const cd = formatCountdown(item.releaseDate);
          const hits = itemMatchesOshi(item);
          const r18Class = item.category === 'r18' ? 'is-r18-media' : '';
          const visibleCount = getVisibleOffers(item).length;
          return `
            <div class="timeline-item" data-open-id="${escapeHtml(item.id)}">
              <div class="${r18Class}" style="flex-shrink:0;border-radius:8px;">
                ${renderCoverImg(item, 'timeline-thumb')}
              </div>
              <div class="timeline-body">
                <div class="shelf-edition-badges">
                  <span class="oshi-badge">💖 ${escapeHtml(hits[0])}</span>
                  ${item.category === 'r18' ? '<span class="cat-badge is-r18">🔞R18</span>' : ''}
                  <span style="font-size:10px;font-weight:800;color:var(--accent);">${escapeHtml(cd.text)}</span>
                </div>
                <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
                <p class="timeline-sub">
                  ${escapeHtml(formatDateLabel(item.releaseDate))} ・ ¥${(item.price || 0).toLocaleString()}${
                    visibleCount > 1 ? ` ・ 🎁${visibleCount}版` : ''
                  }
                </p>
              </div>
              <div class="timeline-actions">
                ${renderStatusMarkButton(item, false)}
                <button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">🔍 確認</button>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }
}

function renderOshiAndShelf() {
  switchOshiSubTab(state.oshiSubTab);
  renderOshiCorner();

  const trackedEntries = getAllMarkedEntries();

  // Keep sub-tab counts live
  const subNav = document.getElementById('oshiSubNav');
  if (subNav) {
    const oshiBtn = subNav.querySelector('[data-oshi-subtab="oshi"]');
    const shelfBtn = subNav.querySelector('[data-oshi-subtab="shelf"]');
    if (oshiBtn) {
      oshiBtn.textContent = `💖 推しコーナー (${state.oshiKeywords.length})`;
    }
    if (shelfBtn) {
      shelfBtn.textContent = `🏷 マーク棚 (${trackedEntries.length})`;
    }
  }

  const countByBucket = {
    all: trackedEntries.length,
    considering: trackedEntries.filter((e) => e.status === 'considering').length,
    want: trackedEntries.filter((e) => e.status === 'want').length,
    reserved: trackedEntries.filter((e) => e.status === 'reserved').length,
    owned: trackedEntries.filter((e) => e.status === 'owned').length,
    skip: trackedEntries.filter((e) => e.status === 'skip').length,
  };

  const cornerTiles = [
    { id: 'all', icon: '🏷', label: '全マーク版', count: countByBucket.all },
    { id: 'considering', icon: '🤔', label: '検討中', count: countByBucket.considering },
    { id: 'want', icon: '👀', label: '買う予定', count: countByBucket.want },
    { id: 'reserved', icon: '🛒', label: '予約済', count: countByBucket.reserved },
    { id: 'owned', icon: '✅', label: '購入済', count: countByBucket.owned },
    { id: 'skip', icon: '🙅', label: '買わない', count: countByBucket.skip },
  ];

  const cornerGrid = document.getElementById('shelfCornerGrid');
  if (cornerGrid) {
    cornerGrid.innerHTML = cornerTiles
      .map(
        (t) => `
        <button
          class="status-corner-tile ${state.shelfFilter === t.id ? 'active' : ''}"
          type="button"
          data-shelf-filter="${t.id}"
        >
          <div class="status-corner-icon">${t.icon}</div>
          <div class="status-corner-count">${t.count}</div>
          <div class="status-corner-label">${escapeHtml(t.label)}</div>
        </button>
      `
      )
      .join('');
  }

  const plannedYen = trackedEntries
    .filter((e) => e.status === 'want' || e.status === 'reserved')
    .reduce((sum, e) => sum + e.price, 0);
  const ownedYen = trackedEntries
    .filter((e) => e.status === 'owned')
    .reduce((sum, e) => sum + e.price, 0);
  const consideringYen = trackedEntries
    .filter((e) => e.status === 'considering')
    .reduce((sum, e) => sum + e.price, 0);

  document.getElementById('shelfStats').innerHTML = `
    <div class="stat-box">
      <div class="stat-val">¥${plannedYen.toLocaleString()}</div>
      <div class="stat-label">買う予定＋予約済</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">¥${consideringYen.toLocaleString()}</div>
      <div class="stat-label">🤔 検討中の合計</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">¥${ownedYen.toLocaleString()}</div>
      <div class="stat-label">✅ 購入済 (${countByBucket.owned}版)</div>
    </div>
  `;

  const upcomingPlanned = getUpcomingPlannedEntries();
  const actionsBar = document.getElementById('shelfActionsBar');
  if (actionsBar) {
    actionsBar.innerHTML = `
      <span style="font-size:11px;color:var(--ink-secondary);font-weight:700;">
        📚 登録済み：<strong>${trackedEntries.length}エディション</strong>（表紙・特典別管理）
      </span>
      <button
        class="bulk-ics-btn"
        type="button"
        data-download-bulk-ics="upcoming"
        ${upcomingPlanned.length === 0 ? 'disabled' : ''}
      >📅 発売予定を一括カレンダー登録 (.ics / ${upcomingPlanned.length}件)</button>
    `;
  }

  const budgetPanel = document.getElementById('shelfBudgetPanel');
  if (budgetPanel) {
    budgetPanel.innerHTML = renderMonthlyBudgetMeterHtml();
  }

  const visibleEntries = trackedEntries
    .filter((e) => state.shelfFilter === 'all' || e.status === state.shelfFilter)
    .sort((a, b) => new Date(a.item.releaseDate) - new Date(b.item.releaseDate));

  const shelfList = document.getElementById('shelfList');
  if (!visibleEntries.length) {
    shelfList.innerHTML =
      '<p style="font-size:12px;color:var(--ink-muted);margin:0;">このステータスの表紙・特典はまだありません。各カードの「🏷 マーク」または比較画面から表紙・特典単位で登録できます。</p>';
    return;
  }

  shelfList.innerHTML = visibleEntries
    .map(({ item, offer, status, price }) => {
      const cd = formatCountdown(item.releaseDate);
      const store = offer ? STORES[offer.store] || { shortName: offer.store, badgeClass: 'store-amazon' } : null;
      const r18Class = item.category === 'r18' ? 'is-r18-media' : '';
      return `
        <div class="timeline-item ${status === 'skip' ? 'is-skipped' : ''}" data-open-id="${escapeHtml(item.id)}">
          <div class="${r18Class}" style="flex-shrink:0;border-radius:8px;">
            ${renderOfferThumbImg(item, offer, 'timeline-thumb')}
          </div>
          <div class="timeline-body">
            <div class="shelf-edition-badges">
              ${
                store
                  ? `<span class="store-badge ${store.badgeClass}" style="font-size:9px;padding:1px 6px;">${escapeHtml(store.shortName)}</span>`
                  : `<span class="cat-badge">作品全体</span>`
              }
              <span class="shelf-edition-label">${escapeHtml(
                offer ? offer.edition : '通常マーク'
              )}</span>
            </div>
            <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
            <p class="timeline-sub">
              ${escapeHtml(offer?.bonusText || (item.coverTalents || []).join('・'))}
            </p>
            <p class="timeline-sub" style="margin-top:2px;">
              ${escapeHtml(formatDateLabel(item.releaseDate))}（${escapeHtml(cd.text)}） ・ <strong>¥${price.toLocaleString()}</strong>
            </p>
          </div>
          <div class="timeline-actions">
            ${renderStatusMarkButton(item, false, offer ? offer.id : null)}
            ${
              offer
                ? `<a
                    class="quick-preview-icon-btn"
                    href="${escapeHtml(offer.url)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-stop-prop="1"
                  >購入先 ↗</a>`
                : `<button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">🔍 確認</button>`
            }
          </div>
        </div>
      `;
    })
    .join('');
}

function renderHubLauncher() {
  const quickEl = document.getElementById('hubQuickKeywords');
  if (!quickEl.childElementCount) {
    quickEl.innerHTML = QUICK_HUB_KEYWORDS.map(
      (kw) => `<button class="keyword-pill" type="button" data-hub-kw="${escapeHtml(kw)}">${escapeHtml(kw)}</button>`
    ).join('');
  }

  const query = document.getElementById('hubQueryInput').value.trim();
  const bonusOnly = document.getElementById('hubBonusOnly').checked;
  const grid = document.getElementById('hubLauncherGrid');

  if (!query) {
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;"><p>雑誌名・カレンダー名・タレント名を入力すると、5ストアの検索リンクが一括生成されます。</p></div>';
    return;
  }

  const links = buildAllStoreSearchLinks(query, bonusOnly);
  const socialQuick = [
    {
      name: 'X（写真付き宣伝・オフショット）',
      note: 'アカウント不要の公開検索で最新カットをチェック',
      badgeClass: 'store-tsutaya',
      url: `https://x.com/search?q=${encodeURIComponent(`${query} (表紙 OR 特典 OR ポストカード OR オフショット) filter:images`)}&f=live`,
    },
    {
      name: 'PR TIMES / 公式先行カット検索',
      note: '出版社公式プレスリリースの高画質カットを探す',
      badgeClass: 'store-hmv',
      url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${query} 先行カット OR 表紙 OR 特典`)}`,
    },
  ];

  grid.innerHTML = [...links, ...socialQuick]
    .map(
      (link) => `
      <a class="launcher-card" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
        <div>
          <div class="launcher-name">
            <span class="store-badge ${link.badgeClass}">${escapeHtml(link.name)}</span>
          </div>
          <div class="launcher-note">${escapeHtml(link.pickupNote || link.note)}</div>
        </div>
        <span class="launcher-cta ${link.badgeClass}">探す ↗</span>
      </a>
    `
    )
    .join('');
}

/* =========================================================
   Quick 1-Tap Per-Edition Status Picker Sheet
   ========================================================= */
function openStatusPicker(itemId, initialOfferId = null) {
  const item = getItemById(itemId);
  if (!item) return;

  const visibleOffers = getVisibleOffers(item);
  state.statusPickerItemId = itemId;

  if (initialOfferId && visibleOffers.some((o) => o.id === initialOfferId)) {
    state.statusPickerOfferId = initialOfferId;
  } else {
    const firstMarked = visibleOffers.find((o) => getOfferStatus(o.id));
    state.statusPickerOfferId = (firstMarked || visibleOffers[0])?.id || null;
  }

  renderStatusPickerBody();
  document.getElementById('statusPickerSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderStatusPickerBody() {
  const item = getItemById(state.statusPickerItemId);
  if (!item) return;

  const visibleOffers = getVisibleOffers(item);
  const selectedOffer =
    visibleOffers.find((o) => o.id === state.statusPickerOfferId) || visibleOffers[0] || null;
  state.statusPickerOfferId = selectedOffer?.id || null;

  const currentStatus = selectedOffer
    ? getOfferStatus(selectedOffer.id)
    : getLegacyItemStatus(item.id);

  document.getElementById('statusPickerItemMeta').innerHTML = `
    ${renderOfferThumbImg(item, selectedOffer, 'quick-status-thumb')}
    <div style="min-width:0;">
      <h3 id="statusPickerTitle" class="quick-status-item-title">${escapeHtml(item.title)}</h3>
      <div class="quick-status-item-sub">
        ${escapeHtml(formatDateLabel(item.releaseDate))} ・ ¥${(
          selectedOffer?.price || item.price || 0
        ).toLocaleString()}
      </div>
    </div>
  `;

  const edWrap = document.getElementById('statusPickerEditionWrap');
  if (visibleOffers.length > 1) {
    edWrap.style.display = 'block';
    edWrap.innerHTML = `
      <div class="status-picker-ed-label">
        📌 どの表紙・特典をマークしますか？（タップして選択・複数版OK）
      </div>
      <div class="edition-choice-list">
        ${visibleOffers
          .map((offer) => {
            const st = getOfferStatus(offer.id);
            const meta = st ? SHELF_STATUS_META[st] : null;
            const store = STORES[offer.store] || { shortName: offer.store, badgeClass: 'store-amazon' };
            const isSel = selectedOffer && selectedOffer.id === offer.id;
            return `
              <button
                class="edition-choice-row ${isSel ? 'selected' : ''}"
                type="button"
                data-select-picker-offer="${escapeHtml(offer.id)}"
              >
                ${renderOfferThumbImg(item, offer, 'edition-choice-thumb')}
                <div class="edition-choice-info">
                  <div class="edition-choice-top">
                    <span class="store-badge ${store.badgeClass}" style="font-size:9px;padding:1px 5px;">${escapeHtml(store.shortName)}</span>
                    <span>${escapeHtml(offer.edition)}</span>
                  </div>
                  <div class="edition-choice-sub">
                    ${escapeHtml(offer.bonusText)} ・ ¥${(offer.price || item.price || 0).toLocaleString()}
                  </div>
                </div>
                <span class="edition-choice-status ${meta ? meta.colorClass : ''}">
                  ${meta ? `${meta.icon} ${escapeHtml(meta.short)}` : '未判定'}
                </span>
              </button>
            `;
          })
          .join('')}
      </div>
    `;
  } else if (selectedOffer) {
    const store = STORES[selectedOffer.store] || { shortName: selectedOffer.store, badgeClass: 'store-amazon' };
    edWrap.style.display = 'block';
    edWrap.innerHTML = `
      <div class="status-picker-ed-label">
        📌 対象版：<span class="store-badge ${store.badgeClass}" style="font-size:9px;padding:1px 6px;">${escapeHtml(store.shortName)}</span>
        ${escapeHtml(selectedOffer.edition)}
      </div>
    `;
  } else {
    edWrap.style.display = 'none';
    edWrap.innerHTML = '';
  }

  document.getElementById('statusPickerGrid').innerHTML = SHELF_STATUS_ORDER.map((key) => {
    const meta = SHELF_STATUS_META[key];
    return `
      <button
        class="quick-status-choice ${meta.colorClass} ${currentStatus === key ? 'active' : ''}"
        type="button"
        data-pick-status="${key}"
      >
        <span class="quick-status-choice-icon">${meta.icon}</span>
        <div>
          <span class="quick-status-choice-label">${escapeHtml(meta.short)}</span>
          <span class="quick-status-choice-hint">${escapeHtml(meta.hint)}</span>
        </div>
      </button>
    `;
  }).join('');

  document.getElementById('statusPickerClearBtn').style.visibility = currentStatus ? 'visible' : 'hidden';
}

function closeStatusPicker() {
  state.statusPickerItemId = null;
  state.statusPickerOfferId = null;
  document.getElementById('statusPickerSheet').classList.remove('open');
  if (!state.selectedItemId && !document.getElementById('photoLightbox').classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

/* =========================================================
   Upgraded 1-Tap Quick-Check Fullscreen Photo Lightbox
   ========================================================= */
function openLightbox(photos, index = 0) {
  if (!photos || !photos.length) return;
  state.lightboxPhotos = photos;
  state.lightboxIndex = Math.max(0, Math.min(index, photos.length - 1));
  renderLightbox();
  document.getElementById('photoLightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('photoLightbox').classList.remove('open');
  if (!state.selectedItemId && !state.statusPickerItemId) {
    document.body.style.overflow = '';
  }
}

function renderLightbox() {
  const photos = state.lightboxPhotos;
  const photo = photos[state.lightboxIndex];
  if (!photo) return;

  const img = document.getElementById('lightboxImg');
  img.onerror = () => {
    img.onerror = null;
    img.src = photo.fallbackUri;
  };
  img.src = photo.url || photo.fallbackUri;
  img.alt = photo.caption;

  document.getElementById('lightboxCounter').textContent = `${state.lightboxIndex + 1} / ${photos.length}`;
  document.getElementById('lightboxTitleBadge').textContent = photo.itemTitle || '';
  document.getElementById('lightboxCaption').textContent = photo.caption;
  const kindMeta = PHOTO_KIND_META[photo.kind] || { icon: '📷', label: '関連写真' };
  document.getElementById('lightboxSource').textContent = `${kindMeta.icon} ${kindMeta.label} ・ ${photo.source}`;

  const thumbsEl = document.getElementById('lightboxThumbs');
  if (photos.length > 1) {
    thumbsEl.style.display = 'flex';
    thumbsEl.innerHTML = photos
      .map(
        (p, idx) => `
        <button
          class="lightbox-thumb-pill ${idx === state.lightboxIndex ? 'active' : ''}"
          type="button"
          data-lightbox-goto="${idx}"
        >${escapeHtml(p.tabLabel || `${idx + 1}枚目`)}</button>
      `
      )
      .join('');
  } else {
    thumbsEl.style.display = 'none';
    thumbsEl.innerHTML = '';
  }

  const offerBar = document.getElementById('lightboxOfferBar');
  const offer = photo.offer;
  if (offer) {
    const store = STORES[offer.store] || {
      name: offer.store,
      shortName: offer.store,
      badgeClass: 'store-amazon',
    };
    const item = photo.itemId ? getItemById(photo.itemId) : null;
    const basePrice = photo.amazonBasePrice || (item ? getAmazonBasePrice(item) : offer.price || 0);
    const price = offer.price || item?.price || 0;
    const diff = price - basePrice;

    let diffHtml = '';
    if (offer.store === 'amazon') {
      diffHtml = `<span class="lightbox-offer-diff">基本購入先</span>`;
    } else if (diff === 0) {
      diffHtml = `<span class="lightbox-offer-diff">Amazon同価格</span>`;
    } else if (diff > 0) {
      diffHtml = `<span class="lightbox-offer-diff is-plus">Amazon比 +¥${diff.toLocaleString()}</span>`;
    } else {
      diffHtml = `<span class="lightbox-offer-diff">Amazon比 -¥${Math.abs(diff).toLocaleString()}</span>`;
    }

    const pendingNote = photo.isPendingArt ? '【表紙表示・絵柄解禁待ち】' : '';

    offerBar.classList.add('visible');
    offerBar.innerHTML = `
      <div class="lightbox-offer-info">
        <div class="lightbox-offer-top">
          <span class="store-badge ${store.badgeClass}">${escapeHtml(store.shortName)}</span>
          <span class="lightbox-offer-price">¥${price.toLocaleString()}</span>
          ${diffHtml}
        </div>
        <div class="lightbox-offer-bonus">${escapeHtml(pendingNote + (offer.bonusText || offer.edition))}</div>
      </div>
      <a
        class="lightbox-buy-cta ${offer.store === 'amazon' ? 'is-amazon' : ''}"
        href="${escapeHtml(offer.url)}"
        target="_blank"
        rel="noopener noreferrer"
      >🛒 ${escapeHtml(store.shortName)}で買う ↗</a>
    `;
  } else {
    offerBar.classList.remove('visible');
    offerBar.innerHTML = '';
  }

  // Per-Edition 1-Tap Quick Status Bar inside Lightbox
  const targetEl = document.getElementById('lightboxStatusTarget');
  const statusBar = document.getElementById('lightboxStatusBar');
  if (photo.itemId) {
    const targetOfferId = offer?.id || '';
    const currentStatus = targetOfferId ? getOfferStatus(targetOfferId) : getLegacyItemStatus(photo.itemId);
    if (targetEl) {
      targetEl.style.display = 'flex';
      targetEl.textContent = targetOfferId
        ? `📌 マーク対象：${formatOfferShortLabel(offer)}`
        : `📌 マーク対象：${photo.itemTitle}`;
    }
    statusBar.style.display = 'flex';
    statusBar.innerHTML = SHELF_STATUS_ORDER.map((key) => {
      const meta = SHELF_STATUS_META[key];
      return `
        <button
          class="lightbox-status-btn ${currentStatus === key ? 'active' : ''}"
          type="button"
          data-lightbox-status="${key}"
          data-lightbox-item="${escapeHtml(photo.itemId)}"
          data-lightbox-offer="${escapeHtml(targetOfferId)}"
        >${meta.icon} ${escapeHtml(meta.short)}</button>
      `;
    }).join('');
  } else {
    if (targetEl) targetEl.style.display = 'none';
    statusBar.style.display = 'none';
    statusBar.innerHTML = '';
  }

  const link = document.getElementById('lightboxArticleLink');
  link.href = photo.articleUrl || '#';
  link.style.display = !offer && photo.articleUrl && photo.articleUrl !== '#' ? 'inline-flex' : 'none';

  const openItemBtn = document.getElementById('lightboxOpenItemBtn');
  openItemBtn.dataset.jumpItemId = photo.itemId || '';
  openItemBtn.style.display = photo.itemId && state.selectedItemId !== photo.itemId ? 'inline-block' : 'none';

  document.getElementById('lightboxPrevBtn').style.display = photos.length > 1 ? 'block' : 'none';
  document.getElementById('lightboxNextBtn').style.display = photos.length > 1 ? 'block' : 'none';
}

/* =========================================================
   .ics Release Calendar Download (Single + Bulk Export!)
   ========================================================= */
function escapeIcsText(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function buildIcsEventLines({ uid, releaseDate, summary, description, alarmDesc }) {
  const start = releaseDate.replace(/-/g, '');
  const nextDayObj = new Date(`${releaseDate}T00:00:00`);
  nextDayObj.setDate(nextDayObj.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const end = `${nextDayObj.getFullYear()}${pad(nextDayObj.getMonth() + 1)}${pad(nextDayObj.getDate())}`;
  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VEVENT',
    `UID:${uid}@happy-magazine-center`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(alarmDesc)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

function triggerIcsDownload(eventsLines, filename) {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Happy Magazine Center//Release Reminder//JA',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Happy Magazine Center 発売予定',
    ...eventsLines,
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadReleaseIcs(item) {
  if (!item || !item.releaseDate) return;
  const visibleOffers = getVisibleOffers(item);
  const bonusLines = visibleOffers
    .filter((o) => o.hasStoreExclusiveBonus)
    .map((o) => `・${STORES[o.store]?.name || o.store}: ${o.bonusText} (${o.url})`);
  const desc = [
    `${item.title}（${(item.coverTalents || []).join('・')}）`,
    `定価目安: ¥${(item.price || 0).toLocaleString()}`,
    bonusLines.length ? '【限定特典ありストア】\n' + bonusLines.join('\n') : '',
    visibleOffers[0]?.url ? `確認リンク: ${visibleOffers[0].url}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = buildIcsEventLines({
    uid: item.id,
    releaseDate: item.releaseDate,
    summary: `【発売】${item.title}`,
    description: desc,
    alarmDesc: `明日発売：${item.title}`,
  });
  triggerIcsDownload(lines, `release-${item.id}.ics`);
}

function downloadBulkReleaseIcs(entries) {
  if (!entries || !entries.length) return;
  const allEventLines = [];
  for (const entry of entries) {
    const { item, offer, status, price } = entry;
    if (!item?.releaseDate) continue;
    const stMeta = SHELF_STATUS_META[status] || { icon: '📌', short: '' };
    const storeName = offer ? STORES[offer.store]?.name || offer.store : '各ストア';
    const editionSuffix = offer ? `【${STORES[offer.store]?.shortName || offer.store}・${offer.edition}】` : '';
    const desc = [
      `ステータス: ${stMeta.icon} ${stMeta.short}`,
      `作品: ${item.title}`,
      offer ? `対象エディション: ${storeName} / ${offer.edition}` : '',
      offer?.bonusText ? `特典内容: ${offer.bonusText}` : '',
      `金額目安: ¥${price.toLocaleString()}`,
      offer?.url ? `購入ページ: ${offer.url}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    allEventLines.push(
      ...buildIcsEventLines({
        uid: offer ? `${item.id}-${offer.id}` : item.id,
        releaseDate: item.releaseDate,
        summary: `${stMeta.icon}【発売】${item.title}${editionSuffix}`,
        description: desc,
        alarmDesc: `明日発売：${item.title} ${editionSuffix}`,
      })
    );
  }
  if (allEventLines.length) {
    triggerIcsDownload(allEventLines, `happy-magazine-releases-${state.referenceDate}.ics`);
  }
}

/* =========================================================
   Detail Bottom Sheet
   ========================================================= */
function openDetailSheet(itemId) {
  const item = getItemById(itemId);
  if (!item) return;

  state.selectedItemId = itemId;
  state.selectedOfferStore = 'all';
  state.selectedPhotoKind = 'all';
  renderDetailSheetBody(item);

  document.getElementById('detailSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDetailSheet() {
  state.selectedItemId = null;
  document.getElementById('detailSheet').classList.remove('open');
  if (!state.statusPickerItemId && !document.getElementById('photoLightbox').classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

function renderBonusDigestHtml(item, visibleOffers, amazonBasePrice) {
  const rows = [];

  for (const inc of item.includedBonuses || []) {
    rows.push(`
      <li class="bonus-digest-item">
        <span class="bonus-digest-store" style="background:#fef3c7;color:#92400e;">本誌付録</span>
        <span>${escapeHtml(inc.label)}</span>
      </li>
    `);
  }

  for (const storeId of STORE_ORDER) {
    if (storeId === 'amazon') continue;
    const storeOffers = visibleOffers.filter(
      (o) => o.store === storeId && o.hasStoreExclusiveBonus === true
    );
    if (!storeOffers.length) continue;
    const store = STORES[storeId];
    const minPrice = Math.min(...storeOffers.map((o) => o.price || item.price || 0));
    const diff = minPrice - amazonBasePrice;
    const diffStr =
      diff === 0
        ? 'Amazon同価格'
        : diff > 0
          ? `Amazon比 +¥${diff.toLocaleString()}`
          : `Amazon比 -¥${Math.abs(diff).toLocaleString()}`;
    const firstText = storeOffers[0].bonusText || storeOffers[0].edition;
    const extraCount = storeOffers.length > 1 ? `（全${storeOffers.length}種）` : '';
    rows.push(`
      <li class="bonus-digest-item">
        <span class="bonus-digest-store ${store.badgeClass}">${escapeHtml(store.shortName)}</span>
        <span>${escapeHtml(firstText)}${extraCount} <strong>[${diffStr}]</strong></span>
      </li>
    `);
  }

  if (!rows.length) {
    rows.push(`
      <li class="bonus-digest-item">
        <span class="bonus-digest-store store-amazon">Amazon</span>
        <span>現在、他ストア限定特典は未発表のためAmazon基本版のみ表示中（定価目安 ¥${(
          amazonBasePrice || 0
        ).toLocaleString()}）</span>
      </li>
    `);
  }

  return `
    <div class="bonus-digest-box">
      <div class="bonus-digest-title">
        <span>📋 特典＆価格 要点まとめ（1秒チェック）</span>
      </div>
      <ul class="bonus-digest-list">${rows.join('')}</ul>
    </div>
  `;
}

function renderDetailSheetBody(item) {
  document.getElementById('sheetTitle').textContent = item.series || '関連写真＆特典比較';

  const cd = formatCountdown(item.releaseDate);
  const allPhotos = getItemPhotos(item);
  const quickPreviewCount = buildQuickPreviewPhotos(item).length;
  const filteredPhotos = allPhotos.filter(
    (p) => state.selectedPhotoKind === 'all' || p.kind === state.selectedPhotoKind
  );
  const photoKinds = [...new Set(allPhotos.map((p) => p.kind))];

  const visibleOffers = getVisibleOffers(item);
  const amazonBasePrice = getAmazonBasePrice(item);
  const availableStores = STORE_ORDER.filter((sid) =>
    visibleOffers.some((o) => o.store === sid)
  );
  const offers = visibleOffers.filter(
    (o) => state.selectedOfferStore === 'all' || o.store === state.selectedOfferStore
  );
  const markedOffers = getItemMarkedOffers(item);
  const watch = getItemArtworkWatch(item);
  const r18Class = item.category === 'r18' ? 'is-r18-media' : '';

  const officialSns = getOfficialSnsForItem(item);
  const talentPromos = buildTalentPromoLinks(item);
  const pressArticles = item.pressArticles || [];
  const itemCoverFallback = item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || '';

  // Per-Edition Marked Summary or Single-Offer Quick Bar
  let statusSummaryHtml = '';
  if (visibleOffers.length > 1) {
    statusSummaryHtml = `
      <div class="edition-marks-summary">
        <div class="edition-marks-summary-title">
          📌 表紙・特典別マーク状況（下の各カードで版ごとに切替できます）
        </div>
        <div class="edition-marks-pills">
          ${
            markedOffers.length
              ? markedOffers
                  .map(({ offer, status }) => {
                    const meta = SHELF_STATUS_META[status];
                    return `
                      <button
                        class="edition-mark-chip ${meta.colorClass}"
                        type="button"
                        data-open-status-picker="${escapeHtml(item.id)}"
                        data-picker-offer="${escapeHtml(offer.id)}"
                      >${meta.icon} ${escapeHtml(meta.short)}：${escapeHtml(formatOfferShortLabel(offer))}</button>
                    `;
                  })
                  .join('')
              : `<span style="font-size:11px;color:var(--ink-muted);">まだ版別マークはありません。下の各表紙・特典カードの「🤔/👀/🛒/✅/🙅」から直接マークできます！</span>`
          }
        </div>
      </div>
    `;
  } else {
    const singleOffer = visibleOffers[0] || null;
    const currentStatus = singleOffer ? getOfferStatus(singleOffer.id) : getLegacyItemStatus(item.id);
    statusSummaryHtml = `
      <div class="status-selector" aria-label="マイステータス">
        ${SHELF_STATUS_ORDER.map((key) => {
          const meta = SHELF_STATUS_META[key];
          return `
          <button
            class="status-btn ${meta.colorClass} ${currentStatus === key ? 'active' : ''}"
            type="button"
            ${
              singleOffer
                ? `data-set-offer-status="${key}" data-offer-id="${escapeHtml(singleOffer.id)}"`
                : `data-set-status="${key}"`
            }
          >${meta.icon} ${escapeHtml(meta.short)}</button>
        `;
        }).join('')}
      </div>
    `;
  }

  // Pending Artwork Watch Helper Bar (Proposal 2)
  let pendingCheckHtml = '';
  if (watch.hasPendingWatch) {
    const storeLinks = buildAllStoreSearchLinks(item.title, true);
    const checkTargets = storeLinks.filter(
      (l) => l.id === 'amazon' || l.id === '7net' || l.id === 'rakuten'
    );
    pendingCheckHtml = `
      <div class="pending-check-bar">
        <div>
          <strong>⏳ 絵柄・表紙解禁ウォッチ中</strong>
          ${
            watch.pendingBonusCount > 0
              ? `（特典絵柄 ${watch.pendingBonusCount}件 未公開）`
              : '（通常表紙 解禁待ち）'
          }
        </div>
        <div class="pending-check-links">
          ${checkTargets
            .map(
              (l) =>
                `<a class="pending-check-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.shortName)}確認 ↗</a>`
            )
            .join('')}
          <a
            class="pending-check-link"
            href="https://x.com/search?q=${encodeURIComponent(`${item.title} (表紙 OR 特典 OR 解禁) filter:images`)}&f=live"
            target="_blank"
            rel="noopener noreferrer"
          >𝕏解禁速報 ↗</a>
        </div>
      </div>
    `;
  }

  const body = document.getElementById('sheetBody');
  body.innerHTML = `
    <div class="sheet-hero">
      <button class="sheet-cover-btn ${r18Class}" type="button" data-hero-zoom="${escapeHtml(item.id)}" aria-label="表紙と特典写真を拡大確認">
        ${renderCoverImg(item, 'sheet-cover')}
        <span class="sheet-cover-zoom-badge">🔍 拡大(${quickPreviewCount}枚)</span>
      </button>
      <div class="sheet-meta">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <span class="cat-badge ${item.category === 'r18' ? 'is-r18' : ''}">${escapeHtml(CATEGORY_META[item.category]?.label || '雑誌')}</span>
          <span class="calendar-countdown ${cd.type}">${escapeHtml(formatDateLabel(item.releaseDate))} ・ ${escapeHtml(cd.text)}</span>
        </div>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="sheet-summary">${escapeHtml(item.summary || '')}</p>
        <div style="font-size:12px;font-weight:700;color:var(--ink);">
          定価目安：¥${(item.price || 0).toLocaleString()}（税込） ／ ${escapeHtml(item.publisher || '')}
        </div>
        <div class="sheet-hero-actions">
          <button class="ics-export-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">
            🔍 写真＆特典を一気に確認
          </button>
          <button class="ics-export-btn" type="button" data-download-ics="${escapeHtml(item.id)}">
            📅 カレンダー登録 (.ics)
          </button>
        </div>
        ${(() => {
          const cleanTalents = extractCleanTalentNames(item);
          if (!cleanTalents.length) return '';
          return `<div class="sheet-talent-oshi-bar" aria-label="この作品のタレントをワンタップ推し登録">
            ${cleanTalents
              .map((name) => {
                const isOshi = state.oshiKeywords.includes(name);
                const isVip = state.vipTalents.includes(name);
                return `
                  <span class="sheet-talent-pill ${isOshi ? 'is-oshi' : ''} ${isVip ? 'is-vip' : ''}">
                    <button
                      class="sheet-talent-pill-btn"
                      type="button"
                      data-toggle-oshi="${escapeHtml(name)}"
                      title="${isOshi ? '推し登録中（タップで解除）' : 'タップで💖推し登録'}"
                    >${isOshi ? '💖' : '＋'} ${escapeHtml(name)}</button>
                    <button
                      class="sheet-talent-vip-btn ${isVip ? 'active' : ''}"
                      type="button"
                      data-toggle-vip="${escapeHtml(name)}"
                      title="${isVip ? '👑 VIP超人気枠から解除' : '👑 Sランク超人気VIP枠(+30pt)へ追加'}"
                    >👑</button>
                  </span>
                `;
              })
              .join('')}
          </div>`;
        })()}
      </div>
    </div>

    ${renderBonusDigestHtml(item, visibleOffers, amazonBasePrice)}
    ${pendingCheckHtml}

    ${
      item.printOnlyNote
        ? `<div style="font-size:11px;color:var(--ink-secondary);background:var(--bg);padding:8px 10px;border-radius:10px;margin-bottom:10px;">
            ℹ️ ${escapeHtml(item.printOnlyNote)}
          </div>`
        : ''
    }

    ${statusSummaryHtml}

    <!-- Section 1: Side-by-Side Visual Bonus Variant Comparator (with Per-Edition Status!) -->
    <div class="sheet-section">
      <div class="compare-header-bar">
        <div class="sheet-section-title" style="margin:0;">
          <span>🎁 表紙・特典エディション比較＆個別マーク（${offers.length}種）</span>
        </div>
        ${
          offers.length > 1
            ? `<div class="compare-layout-switch" role="group" aria-label="比較レイアウト">
                <button class="compare-layout-btn ${state.offerCompareLayout === 'scroll' ? 'active' : ''}" type="button" data-compare-layout="scroll">↔ 横比較</button>
                <button class="compare-layout-btn ${state.offerCompareLayout === 'grid' ? 'active' : ''}" type="button" data-compare-layout="grid">⊞ 2列比較</button>
              </div>`
            : ''
        }
      </div>
      <div style="font-size:11px;color:var(--ink-muted);margin-bottom:6px;">
        ※ 各カード下のボタンで「この表紙・この特典だけ予約済／購入済」と個別に記録できます。
      </div>

      ${
        availableStores.length > 1
          ? `<div class="chip-scroll" style="padding-top:2px;">
              <button class="filter-chip ${state.selectedOfferStore === 'all' ? 'store-active' : ''}" type="button" data-offer-store="all">
                すべて (${visibleOffers.length})
              </button>
              ${availableStores
                .map((sid) => {
                  const cnt = visibleOffers.filter((o) => o.store === sid).length;
                  return `
                    <button class="filter-chip ${state.selectedOfferStore === sid ? 'store-active' : ''}" type="button" data-offer-store="${sid}">
                      ${escapeHtml(STORES[sid].shortName)} (${cnt})
                    </button>
                  `;
                })
                .join('')}
            </div>`
          : ''
      }

      ${(() => {
        const offerPhotos = offers.map((offer, idx) => {
          const st = STORES[offer.store] || { name: offer.store, shortName: offer.store };
          const kind = (offer.bonusTypes || []).includes('cover')
            ? 'limited_cover'
            : offer.hasStoreExclusiveBonus
              ? 'bonus'
              : 'cover';
          const hasRealArt = Boolean(offer.imageUrl);
          return {
            itemId: item.id,
            itemTitle: item.title,
            itemCategory: item.category,
            url: offer.imageUrl || itemCoverFallback || '',
            caption: `${st.name}｜${offer.edition}：${offer.bonusText}`,
            source: hasRealArt
              ? `${st.name}（${offer.store === 'amazon' ? '公式書影' : '特典絵柄公開済'}）`
              : offer.store === 'amazon'
                ? `${st.name}（表紙解禁待ち）`
                : `${st.name}（表紙表示・特典絵柄解禁待ち）`,
            kind,
            tabLabel: `${hasRealArt ? '✨' : '⏳'}${st.shortName}${offers.length > 1 ? idx + 1 : ''}`,
            articleUrl: offer.url,
            offer,
            isPendingArt: !hasRealArt,
            amazonBasePrice,
            fallbackUri: createGalleryPhotoFallbackDataUri(item, {
              caption: `${offer.edition} ${offer.talent || ''}`.trim(),
              source: st.name,
              kind,
            }),
          };
        });
        body._offerPhotos = offerPhotos;

        const containerClass =
          state.offerCompareLayout === 'grid' || offers.length === 1
            ? 'compare-grid-2col'
            : 'compare-track';

        return `<div class="${containerClass}">
          ${offers
            .map((offer, idx) => {
              const store = STORES[offer.store] || {
                name: offer.store,
                shortName: offer.store,
                badgeClass: 'store-amazon',
              };
              const price = offer.price || item.price || 0;
              const diff = price - amazonBasePrice;
              let diffPill = '';
              if (offer.store === 'amazon') {
                diffPill = `<span class="compare-diff-pill">基本購入先</span>`;
              } else if (diff === 0) {
                diffPill = `<span class="compare-diff-pill">同価格</span>`;
              } else if (diff > 0) {
                diffPill = `<span class="compare-diff-pill is-plus">Amazon比 +¥${diff.toLocaleString()}</span>`;
              } else {
                diffPill = `<span class="compare-diff-pill">Amazon比 -¥${Math.abs(diff).toLocaleString()}</span>`;
              }

              const artBadge = offer.imageUrl
                ? offer.store === 'amazon'
                  ? `<span class="compare-art-badge">📘 公式書影</span>`
                  : `<span class="compare-art-badge">✨ 特典絵柄</span>`
                : offer.store === 'amazon'
                  ? `<span class="compare-art-badge is-pending">⏳ 表紙待ち</span>`
                  : `<span class="compare-art-badge is-pending">⏳ 絵柄待ち</span>`;

              const offerStatus = getOfferStatus(offer.id);
              const offerStatusMeta = offerStatus ? SHELF_STATUS_META[offerStatus] : null;

              return `
                <article class="compare-card ${offer.hasStoreExclusiveBonus ? 'is-bonus' : ''} ${
                offerStatus === 'skip' ? 'is-offer-skipped' : ''
              }">
                  <button class="compare-img-btn ${r18Class}" type="button" data-offer-photo-idx="${idx}" aria-label="${escapeHtml(offer.edition)}を拡大">
                    ${renderPhotoImg(offerPhotos[idx])}
                    <span class="compare-store-float ${store.badgeClass}">${escapeHtml(store.shortName)}</span>
                    ${
                      offerStatusMeta
                        ? `<span class="compare-status-float ${offerStatusMeta.colorClass}">${offerStatusMeta.icon} ${escapeHtml(offerStatusMeta.short)}</span>`
                        : ''
                    }
                    ${artBadge}
                    <span class="compare-zoom-hint">🔍 拡大</span>
                  </button>
                  <div class="compare-body">
                    <div class="compare-edition">${escapeHtml(offer.edition)}</div>
                    <div class="compare-bonus-desc">${escapeHtml(offer.bonusText)}</div>
                    <div class="compare-price-row">
                      <span class="compare-price">¥${price.toLocaleString()}</span>
                      ${diffPill}
                    </div>
                    <a
                      class="compare-buy-btn ${offer.store === 'amazon' ? 'is-amazon' : ''}"
                      href="${escapeHtml(offer.url)}"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ${escapeHtml(store.shortName)}で買う ↗
                    </a>
                    <div class="compare-status-bar" role="group" aria-label="${escapeHtml(offer.edition)}のステータス">
                      ${SHELF_STATUS_ORDER.map((key) => {
                        const m = SHELF_STATUS_META[key];
                        const tinyLabel =
                          key === 'considering'
                            ? '検討'
                            : key === 'want'
                              ? '予定'
                              : key === 'reserved'
                                ? '予約'
                                : key === 'owned'
                                  ? '購入'
                                  : '見送';
                        return `
                          <button
                            class="compare-st-btn ${m.colorClass} ${offerStatus === key ? 'active' : ''}"
                            type="button"
                            data-set-offer-status="${key}"
                            data-offer-id="${escapeHtml(offer.id)}"
                            title="${escapeHtml(offer.edition)}を「${escapeHtml(m.short)}」にする"
                          >${m.icon}<span>${tinyLabel}</span></button>
                        `;
                      }).join('')}
                    </div>
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>`;
      })()}
    </div>

    <!-- Section 2: Related Photos Gallery -->
    <div class="sheet-section">
      <div class="sheet-section-title">
        <span>📷 関連フォトギャラリー（${allPhotos.length}枚・タップで拡大）</span>
      </div>
      ${
        photoKinds.length > 1
          ? `<div class="chip-scroll" style="padding-top:0;margin-bottom:8px;">
              <button class="filter-chip ${state.selectedPhotoKind === 'all' ? 'active' : ''}" type="button" data-photo-kind="all">
                すべて (${allPhotos.length})
              </button>
              ${photoKinds
                .map((k) => {
                  const meta = PHOTO_KIND_META[k] || { icon: '📷', label: k };
                  return `<button class="filter-chip ${state.selectedPhotoKind === k ? 'active' : ''}" type="button" data-photo-kind="${k}">
                    ${meta.icon} ${escapeHtml(meta.label)}
                  </button>`;
                })
                .join('')}
            </div>`
          : ''
      }
      <div class="gallery-grid">
        ${filteredPhotos
          .map((photo, idx) => {
            const kindMeta = PHOTO_KIND_META[photo.kind] || { icon: '📷', label: '写真' };
            return `
              <button class="gallery-thumb" type="button" data-sheet-photo-idx="${idx}">
                <div class="gallery-thumb-img-wrap ${r18Class}">
                  ${renderPhotoImg(photo)}
                  <span class="wall-kind-tag" style="font-size:9px;padding:1px 6px;">${kindMeta.icon} ${escapeHtml(kindMeta.label)}</span>
                </div>
                <span class="gallery-thumb-cap">${escapeHtml(photo.caption)}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>

    <!-- Section 3: Official Press & Preview Cut Articles -->
    ${
      pressArticles.length
        ? `<div class="sheet-section">
            <div class="sheet-section-title">
              <span>📰 公式先行カット＆ニュース特集（ログイン不要）</span>
            </div>
            <div class="press-list">
              ${pressArticles
                .map(
                  (art) => `
                  <a class="press-link-card" href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer">
                    <div>
                      <div class="press-title">${escapeHtml(art.title)}</div>
                      <div class="press-meta">${escapeHtml(art.source)} ・ ${escapeHtml(art.photoCountHint || '関連写真を見る')}</div>
                    </div>
                    <span class="detail-trigger-btn">見る ↗</span>
                  </a>
                `
                )
                .join('')}
            </div>
          </div>`
        : ''
    }

    <!-- Section 4: Magazine & Cover Girl SNS Off-shot Hub -->
    <div class="sheet-section">
      <div class="sheet-section-title">
        <span>📱 公式SNS＆カバーガール宣伝・オフショット（アカウント不要）</span>
      </div>

      ${
        officialSns.length
          ? `<div class="sns-group">
              <div class="sns-group-label">編集部・公式SNS</div>
              <div class="sns-pills">
                ${officialSns
                  .map(
                    (s) => `
                    <a class="sns-pill" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
                      ${s.platform === 'instagram' ? '📸' : s.platform === 'x' ? '𝕏' : s.platform === 'youtube' ? '▶️' : '🌐'}
                      ${escapeHtml(s.label)} ↗
                    </a>
                  `
                  )
                  .join('')}
              </div>
            </div>`
          : ''
      }

      ${talentPromos
        .map(
          (tp) => `
          <div class="sns-group">
            <div class="sns-group-label">🌟 ${escapeHtml(tp.talent)} の宣伝投稿・オフショット</div>
            <div class="sns-pills">
              ${tp.links
                .map(
                  (l) => `
                  <a class="sns-pill" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
                    ${l.platform === 'instagram' ? '📸' : l.platform === 'x' ? '𝕏' : l.platform === 'tiktok' ? '🎵' : '🖼'}
                    ${escapeHtml(l.label)} ↗
                  </a>
                `
                )
                .join('')}
            </div>
          </div>
        `
        )
        .join('')}
    </div>
  `;

  body._filteredPhotos = filteredPhotos;
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  if (tabId === 'urgent') renderUrgentRadar();
  if (tabId === 'calendar') renderCalendar();
  if (tabId === 'oshi') renderOshiAndShelf();
  if (tabId === 'hub') renderHubLauncher();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildGitHubIssueRequestUrl(titleOrQuery = '', rawUrlOrIsbn = '') {
  const cleanTitle = String(titleOrQuery || '').trim();
  const cleanRef = String(rawUrlOrIsbn || '').trim();
  const issueTitle = `【収録リクエスト】${cleanTitle || cleanRef || '新刊追加'}`;
  const issueBody = [
    `作品名・タレント名：${cleanTitle}`,
    `Amazon URL または ISBN：${cleanRef}`,
    '限定特典メモ（あれば）：',
  ].join('\n');
  return `https://github.com/kenandxx/happy-magazine-center/issues/new?title=${encodeURIComponent(
    issueTitle
  )}&body=${encodeURIComponent(issueBody)}`;
}

function buildDraftItemFromOpenBd(book, extracted, bonusMemo = '', idSuffix = 'preview') {
  const releaseDate = book.releaseDate || state.referenceDate;
  const price = Number(book.price) || 3300;
  const category = book.category || 'photobook';
  const talent = book.talent || '注目タレント';
  const memo = String(bonusMemo || '').trim();

  const detectedTypes = [];
  if (memo.includes('ポスター')) detectedTypes.push('poster');
  if (memo.includes('ポストカード')) detectedTypes.push('postcard');
  if (memo.includes('生写真') || memo.includes('ブロマイド')) detectedTypes.push('photo');
  if (/限定表紙|別カバー|アザーカバー/.test(memo)) detectedTypes.push('cover');
  if (/サイン本|直筆サイン/.test(memo)) detectedTypes.push('signed');
  if (memo.includes('DVD')) detectedTypes.push('dvd');
  if (!detectedTypes.length) detectedTypes.push('photo');

  const isbn10 = extracted?.isbn10 || isbn13To10(book.isbn);
  const amazonUrl = isbn10
    ? `https://www.amazon.co.jp/dp/${isbn10}`
    : `https://www.amazon.co.jp/s?k=${encodeURIComponent(book.isbn || book.title)}&i=stripbooks`;

  const storeLinks = buildAllStoreSearchLinks(book.title, true);
  const mentionedStores = [];
  if (/セブン|7net/i.test(memo)) mentionedStores.push('7net');
  if (/楽天/i.test(memo)) mentionedStores.push('rakuten');
  if (/hmv|loppi/i.test(memo)) mentionedStores.push('hmv');
  if (/tsutaya|蔦屋/i.test(memo)) mentionedStores.push('tsutaya');

  const statusVal = diffDays(releaseDate) > 0 ? 'preorder' : 'available';
  const offers = [];

  for (const sid of mentionedStores) {
    const linkObj = storeLinks.find((l) => l.id === sid);
    const storeName = STORES[sid]?.name || sid;
    offers.push({
      id: `custom-isbn-${book.isbn || 'book'}-${sid}-${idSuffix}`,
      store: sid,
      hasStoreExclusiveBonus: true,
      edition: `${storeName} 限定特典`,
      bonusTypes: detectedTypes,
      bonusText: memo || `${storeName}限定特典`,
      talent,
      price,
      status: statusVal,
      artworkStatus: 'pending',
      url: linkObj?.url || amazonUrl,
    });
  }

  offers.push({
    id: `custom-isbn-${book.isbn || 'book'}-amazon-${idSuffix}`,
    store: 'amazon',
    hasStoreExclusiveBonus: false,
    edition: 'Amazon 通常版',
    bonusTypes: ['standard'],
    bonusText: `Amazonで確認（ISBN ${book.isbn || '取得済'}）`,
    talent,
    price,
    status: statusVal,
    artworkStatus: book.coverImageUrl ? 'revealed' : 'pending',
    ...(book.coverImageUrl ? { imageUrl: book.coverImageUrl } : {}),
    url: amazonUrl,
  });

  return {
    id: `custom-isbn-${book.isbn || 'book'}-${idSuffix}`,
    isbn: book.isbn || '',
    title: book.title,
    series: book.publisher || 'openBD自動取込',
    issueLabel: 'URL/ISBN自動取込',
    publisher: book.publisher || '出版社公式',
    category,
    releaseDate,
    price,
    coverTalents: [talent],
    featuredTalents: [talent],
    palette:
      category === 'r18'
        ? ['#881337', '#BE123C', '#FFE4E6']
        : ['#E11D48', '#FB7185', '#FFE4E6'],
    ...(book.coverImageUrl ? { coverImageUrl: book.coverImageUrl } : {}),
    autoDiscovered: true,
    discoveredAt: state.referenceDate,
    includedBonuses: memo.includes('ポスター') ? [{ type: 'poster', label: memo }] : [],
    printOnlyNote: memo || 'Amazon URL / ISBNからopenBD公式書誌を自動取込。',
    summary: book.description || `${book.publisher}より発売の注目タイトル（openBD自動取得）。`,
    gallery: book.coverImageUrl
      ? [
          {
            url: book.coverImageUrl,
            caption: `${book.title} 公式書影`,
            source: 'openBD / 版元ドットコム',
            kind: 'cover',
            articleUrl: amazonUrl,
          },
        ]
      : [],
    pressArticles: [],
    offers,
  };
}

function renderIsbnPreviewScoreHtml(draftItem) {
  const scarcity = calculateScarcityScore(draftItem, {
    referenceDate: state.referenceDate,
    oshiKeywords: state.oshiKeywords,
    vipTalents: state.vipTalents,
    oshiBoostMode: state.oshiBoostMode,
  });
  const reasonsHtml = scarcity.reasons
    .slice(0, 4)
    .map(
      (r) =>
        `<span class="urgent-reason-pill tone-${r.tone}">${r.icon} ${escapeHtml(r.label)}${
          r.points > 0 ? ` +${r.points}` : ''
        }</span>`
    )
    .join('');
  const windowNote = scarcity.inWindow
    ? '🔥 直近〜3ヶ月枠のため「早め予約レーダー」へ即時反映されます！'
    : '📚 一覧・推しコーナー・マーク棚へ即登録されます';
  return `
    <div class="isbn-score-preview">
      <div class="urgent-rank-row">
        <span class="urgent-rank-badge ${scarcity.rankMeta.colorClass}">
          ${escapeHtml(scarcity.rankMeta.badge)}
        </span>
        <span class="urgent-score-meter">
          <span class="urgent-score-track">
            <span class="urgent-score-fill ${scarcity.rankMeta.colorClass}" style="width:${scarcity.score}%"></span>
          </span>
          <span>${scarcity.score}pt</span>
        </span>
      </div>
      <div class="urgent-reasons" style="margin-top:6px;">${
        reasonsHtml || '<span class="urgent-reason-pill tone-neutral">📘 通常枠（推し／VIP登録で即スコアUP）</span>'
      }</div>
      <p class="isbn-window-note">${windowNote}</p>
    </div>
  `;
}

function renderIsbnPreviewBox() {
  const box = document.getElementById('isbnPreviewBox');
  if (!box) return;
  if (!state.isbnLookupPreview) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const { book, extracted } = state.isbnLookupPreview;
  const draftItem = buildDraftItemFromOpenBd(book, extracted, '');
  const catLabel = CATEGORY_META[draftItem.category]?.label || '写真集';
  const existingItem = getAllItems().find(
    (it) =>
      (book.isbn && (it.isbn === book.isbn || JSON.stringify(it).includes(book.isbn))) ||
      it.title === book.title
  );
  const amazonOffer = draftItem.offers.find((o) => o.store === 'amazon');
  const issueUrl = buildGitHubIssueRequestUrl(book.title, book.isbn || amazonOffer?.url || '');

  box.hidden = false;
  box.innerHTML = `
    ${
      existingItem
        ? `<div class="isbn-dup-banner">
            <span>✅ この作品はすでにダッシュボードに収録済みです！</span>
            <button class="detail-trigger-btn" type="button" data-open-id="${escapeHtml(existingItem.id)}">収録済みを開く →</button>
          </div>`
        : ''
    }
    <div class="isbn-preview-main">
      <div class="isbn-preview-cover ${draftItem.category === 'r18' ? 'is-r18-media' : ''}">
        ${renderCoverImg(draftItem)}
      </div>
      <div class="isbn-preview-meta">
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">
          <span class="new-auto-badge">🆕 openBD自動取得</span>
          <span class="cat-badge ${draftItem.category === 'r18' ? 'is-r18' : ''}">${escapeHtml(catLabel)}</span>
        </div>
        <h3 class="isbn-preview-title">${escapeHtml(draftItem.title)}</h3>
        <p class="isbn-preview-sub">
          ${escapeHtml(draftItem.coverTalents.join(' / '))} ・ ${escapeHtml(draftItem.publisher)}
        </p>
        <p class="isbn-preview-sub">
          📅 ${
            book.releaseDate
              ? escapeHtml(formatDateLabel(book.releaseDate))
              : 'openBD発売日未記載（下で変更可）'
          } ・ <strong>¥${draftItem.price.toLocaleString()}</strong> ・ ISBN ${escapeHtml(book.isbn)}
        </p>
      </div>
    </div>
    <div id="isbnLiveScoreSlot">${renderIsbnPreviewScoreHtml(draftItem)}</div>
    <div class="isbn-preview-fields">
      <label class="field-label">
        <span>📅 発売予定日${book.releaseDate ? '' : '（未記載のため確認・変更可）'}</span>
        <input
          id="isbnDateInput"
          class="text-input"
          type="date"
          value="${escapeHtml(draftItem.releaseDate)}"
        />
      </label>
      <label class="field-label">
        <span>🎁 限定特典メモ（任意・書いたストアのみ追加）</span>
        <input
          id="isbnBonusMemoInput"
          class="text-input"
          type="text"
          placeholder="例：セブンネット限定表紙・生写真 / 楽天ポスター / サイン本"
        />
      </label>
    </div>
    <div class="isbn-preview-actions">
      <button id="isbnConfirmImportBtn" class="primary-btn" type="button">
        🚀 ダッシュボード＆早め予約に即投入！
      </button>
      ${
        amazonOffer
          ? `<a class="quick-preview-icon-btn" href="${escapeHtml(amazonOffer.url)}" target="_blank" rel="noopener noreferrer">Amazonで確認 ↗</a>`
          : ''
      }
      <a class="isbn-request-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">📮 公式収録依頼 ↗</a>
    </div>
  `;
}

async function handleIsbnLookup(rawInput) {
  const statusEl = document.getElementById('isbnLookupStatus');
  const btn = document.getElementById('isbnLookupBtn');
  const reqLink = document.getElementById('githubRequestIssueLink');
  const q = String(rawInput || '').trim();

  if (reqLink && q) {
    reqLink.href = buildGitHubIssueRequestUrl('', q);
  }
  if (!q) {
    if (statusEl) {
      statusEl.className = 'isbn-lookup-status is-error';
      statusEl.textContent = '⚠️ Amazonの商品URL（/dp/…）またはISBN（10桁/13桁）を貼り付けてください。';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ openBD照会中...';
  }
  if (statusEl) {
    statusEl.className = 'isbn-lookup-status';
    statusEl.textContent = '🔍 日本の公式書誌DB（openBD）から書影・発売日・定価を取得しています...';
  }

  const res = await lookupBookByIsbnOrUrl(q);

  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔍 書影＆書誌を自動取得';
  }

  if (!res.ok) {
    state.isbnLookupPreview = null;
    renderIsbnPreviewBox();
    if (statusEl) {
      statusEl.className = 'isbn-lookup-status is-error';
      statusEl.textContent = `⚠️ ${res.error}`;
    }
    return;
  }

  state.isbnLookupPreview = { book: res.book, extracted: res.extracted };
  if (reqLink) {
    reqLink.href = buildGitHubIssueRequestUrl(res.book.title, res.book.isbn || q);
  }
  if (statusEl) {
    statusEl.className = 'isbn-lookup-status is-ok';
    statusEl.textContent = '✅ 公式書誌と早め予約スコアを判定しました！下のボタンで即投入できます。';
  }
  renderIsbnPreviewBox();
}

function confirmIsbnImport() {
  if (!state.isbnLookupPreview) return;
  const { book, extracted } = state.isbnLookupPreview;
  const memoInput = document.getElementById('isbnBonusMemoInput');
  const dateInput = document.getElementById('isbnDateInput');
  const bonusMemo = memoInput ? memoInput.value.trim() : '';
  const overrideBook = {
    ...book,
    releaseDate: (dateInput && dateInput.value) || book.releaseDate || state.referenceDate,
  };
  const ts = Date.now();
  const newItem = buildDraftItemFromOpenBd(overrideBook, extracted, bonusMemo, String(ts));

  state.customItems.unshift(newItem);
  saveJson(STORAGE_KEYS.customItems, state.customItems);

  const primaryOffer = newItem.offers.find((o) => o.hasStoreExclusiveBonus) || newItem.offers[0];
  if (primaryOffer) {
    state.offerShelfMap[primaryOffer.id] = 'want';
    saveJson(STORAGE_KEYS.offerShelf, state.offerShelfMap);
  }

  state.isbnLookupPreview = null;
  renderIsbnPreviewBox();
  const input = document.getElementById('isbnImportInput');
  if (input) input.value = '';
  const statusEl = document.getElementById('isbnLookupStatus');
  if (statusEl) {
    statusEl.className = 'isbn-lookup-status is-ok';
    statusEl.textContent = `🎉 「${newItem.title}」をダッシュボード＆早め予約レーダーに投入しました！`;
  }
  const arrival = document.getElementById('shareArrivalBanner');
  if (arrival) {
    arrival.hidden = true;
    arrival.innerHTML = '';
  }

  renderAll();
  openDetailSheet(newItem.id);
}

/* =========================================================
   Proposal A & B: Auto-Sources Telemetry & 1-Tap Share-Sheet Receiver
   ========================================================= */
function renderAutoSourcesStatus() {
  const pill = document.getElementById('rakutenStatusPill');
  const box = document.getElementById('autoSourcesSummaryBox');
  const bmLink = document.getElementById('bookmarkletDragLink');
  if (bmLink && bmLink.getAttribute('href') === '#') {
    bmLink.setAttribute('href', BOOKMARKLET_CODE);
  }
  const baseCode = document.getElementById('shareBaseUrlCode');
  if (baseCode) {
    baseCode.textContent = SHARE_BASE_URL;
  }

  const src = state.autoSources || {
    prtimesPublishers: 15,
    rakutenApiConnected: false,
    lastRunAt: state.lastAutoCheckedAt || '',
    lastRunSummary: '',
  };
  const autoCount = getAllItems().filter((i) => Boolean(i.autoDiscovered)).length;

  if (pill) {
    pill.textContent = src.rakutenApiConnected
      ? '✅ PR TIMES 15社＋楽天API稼働中'
      : 'PR TIMES 15社稼働中 / 楽天API未設定';
    pill.classList.toggle('is-connected', Boolean(src.rakutenApiConnected));
  }

  if (box) {
    const checked = src.lastRunAt ? src.lastRunAt.slice(0, 16).replace('T', ' ') : '毎朝07:00 JST';
    box.innerHTML = `
      <div class="auto-source-row">
        <span class="auto-source-dot is-on"></span>
        <div>
          <strong>PR TIMES 公式RSS（主要${src.prtimesPublishers || 15}出版社）</strong>
          <span>稼働中 ・ 現在 🆕自動発見 <strong>${autoCount}作品</strong> 収録（最終チェック: ${escapeHtml(checked)}）</span>
        </div>
      </div>
      <div class="auto-source-row">
        <span class="auto-source-dot is-on"></span>
        <div>
          <strong>openBD ライブ書誌取得（Amazon URL / ISBN / 共有シート）</strong>
          <span>稼働中 ・ ブラウザ直結で書影・定価・早め予約スコアを即判定</span>
        </div>
      </div>
      <div class="auto-source-row">
        <span class="auto-source-dot ${src.rakutenApiConnected ? 'is-on' : 'is-optional'}"></span>
        <div>
          <strong>楽天ブックスAPI（16主要誌・写真集・🔞R18・2027カレンダー・限定特典）</strong>
          <span>${
            src.rakutenApiConnected
              ? '✅ 連携稼働中！毎朝07:00に楽天ブックス新刊＆限定特典を自動流入'
              : '🔑 未設定（下の無料3ステップで RAKUTEN_APP_ID を入れるだけで自動有効化）'
          }</span>
        </div>
      </div>
    `;
  }
}

async function copyTextToClipboard(text, label = 'コピー') {
  const msg = document.getElementById('shareCopyStatus');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (msg) {
      msg.textContent = `✅ 「${label}」をクリップボードにコピーしました！`;
    }
  } catch {
    if (msg) {
      msg.textContent = `⚠️ 自動コピーできない環境です。上の枠内のテキストを長押ししてコピーしてください。`;
    }
  }
}

function findMatchingCatalogItemByTitle(cleanedTitle) {
  const q = String(cleanedTitle || '')
    .toLowerCase()
    .replace(/[\s『』「」【】()（）・\-!！?？]/g, '');
  if (q.length < 4) return null;
  return (
    getAllItems().find((it) => {
      const norm = String(it.title || '')
        .toLowerCase()
        .replace(/[\s『』「」【】()（）・\-!！?？]/g, '');
      return norm && (norm.includes(q) || q.includes(norm));
    }) || null
  );
}

async function processIncomingSharePayload(payload, { simulated = false } = {}) {
  if (!payload || payload.mode === 'empty') return;

  state.oshiSubTab = 'tools';
  switchTab('oshi');

  const banner = document.getElementById('shareArrivalBanner');
  const importCard = document.getElementById('isbnImportCard');
  if (importCard) {
    setTimeout(() => importCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  const prefix = simulated ? '🧪 共有着信デモ' : '📲 共有リンクを受信しました！';

  if (payload.mode === 'isbn') {
    if (banner) {
      banner.hidden = false;
      banner.className = 'share-arrival-banner is-loading';
      banner.innerHTML = `<strong>${prefix}</strong>（ISBN <code>${escapeHtml(
        payload.isbnInfo.isbn13
      )}</code>）openBDから書影＆早め予約スコアを自動判定中...`;
    }
    const input = document.getElementById('isbnImportInput');
    if (input) input.value = payload.rawText;

    await handleIsbnLookup(payload.rawText);

    if (banner) {
      if (state.isbnLookupPreview) {
        banner.className = 'share-arrival-banner is-ok';
        banner.innerHTML = `
          <div>
            <strong>✅ ${simulated ? '共有着信デモ完了！' : '共有から自動取得＆スコア判定完了！'}</strong>
            <span>下の「🚀 ダッシュボード＆早め予約に即投入！」を1タップで追加できます。</span>
          </div>
        `;
      } else {
        banner.className = 'share-arrival-banner is-warn';
        banner.innerHTML = `
          <div>
            <strong>⚠️ ${prefix}（ISBN ${escapeHtml(payload.isbnInfo.isbn13)} はopenBD未登録）</strong>
            <span>下のメモ登録フォームにタイトルを入力して保存するか、公式収録リクエストを送れます。</span>
          </div>
        `;
        if (payload.cleanedTitle) {
          const addTitle = document.getElementById('addTitle');
          if (addTitle) addTitle.value = payload.cleanedTitle;
        }
        if (payload.safeAmazonUrl) {
          const addAmz = document.getElementById('addAmazonUrl');
          if (addAmz) addAmz.value = payload.safeAmazonUrl;
        }
      }
    }
    return;
  }

  // Case 2: Amazon app short link (amzn.asia / amzn.to) or title-only share without ASIN
  const matchedExisting = findMatchingCatalogItemByTitle(payload.cleanedTitle);
  const addTitle = document.getElementById('addTitle');
  const addAmz = document.getElementById('addAmazonUrl');
  if (addTitle && payload.cleanedTitle) addTitle.value = payload.cleanedTitle;
  if (addAmz && payload.safeAmazonUrl) addAmz.value = payload.safeAmazonUrl;

  const issueUrl = buildGitHubIssueRequestUrl(payload.cleanedTitle, payload.safeAmazonUrl || payload.rawText);

  if (banner) {
    banner.hidden = false;
    banner.className = matchedExisting ? 'share-arrival-banner is-ok' : 'share-arrival-banner is-warn';
    banner.innerHTML = matchedExisting
      ? `
        <div>
          <strong>✅ ${prefix} すでにダッシュボードに収録済みでした！</strong>
          <span>「${escapeHtml(matchedExisting.title)}」を1タップで開けます。</span>
        </div>
        <div class="share-arrival-actions">
          <button class="primary-btn" type="button" data-open-id="${escapeHtml(matchedExisting.id)}">
            📖 収録済み作品を開く →
          </button>
        </div>
      `
      : `
        <div>
          <strong>📲 ${prefix} 短縮URL（amzn.asia等）を受信しました</strong>
          <span>「${escapeHtml(
            payload.cleanedTitle
          )}」は短縮URLのためISBNを含みません。下のメモ欄へ自動入力済みです（Safariで開いて <code>/dp/…</code> URLを共有すると書影まで自動取得できます）。</span>
        </div>
        <div class="share-arrival-actions">
          <button class="primary-btn" type="button" data-hub-search-title="${escapeHtml(payload.cleanedTitle)}">
            ⚡ 5ストア特典を横断検索
          </button>
          ${
            payload.safeAmazonUrl
              ? `<a class="quick-preview-icon-btn" href="${escapeHtml(
                  payload.safeAmazonUrl
                )}" target="_blank" rel="noopener noreferrer">SafariでAmazonを開く ↗</a>`
              : ''
          }
          <a class="isbn-request-link" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">📮 公式収録依頼 ↗</a>
        </div>
      `;
  }
}

function handleIncomingShareFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const payload = parseIncomingSharePayload({
      importParam: params.get('import') || '',
      urlParam: params.get('url') || '',
      textParam: params.get('text') || '',
      titleParam: params.get('title') || '',
      isbnParam: params.get('isbn') || '',
    });
    if (payload.mode === 'empty') return;

    // Clean query string so browser refresh does not re-trigger the share import
    if (window.history && typeof window.history.replaceState === 'function') {
      const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, '', cleanUrl);
    }
    processIncomingSharePayload(payload);
  } catch {
    // Ignore in restricted environments
  }
}

function renderAll() {
  applyPrivacyBlur();
  renderCountdownStrip();
  renderFilterChips();
  renderMagazineGrid();
  renderUrgentRadar();
  renderCalendar();
  renderOshiAndShelf();
  renderAutoSourcesStatus();
  renderHubLauncher();
}

function bindEvents() {
  const privacyBtn = document.getElementById('privacyBlurBtn');
  if (privacyBtn) {
    privacyBtn.addEventListener('click', togglePrivacyBlur);
  }

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    clearSearchBtn.classList.toggle('visible', state.search.length > 0);
    renderMagazineGrid();
  });

  clearSearchBtn.addEventListener('click', () => {
    state.search = '';
    searchInput.value = '';
    clearSearchBtn.classList.remove('visible');
    renderMagazineGrid();
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderMagazineGrid();
  });

  const oshiOnlyToggle = document.getElementById('oshiOnlyToggle');
  if (oshiOnlyToggle) {
    oshiOnlyToggle.addEventListener('change', (e) => {
      state.oshiOnly = e.target.checked;
      renderMagazineGrid();
    });
  }

  const newAutoOnlyToggle = document.getElementById('newAutoOnlyToggle');
  if (newAutoOnlyToggle) {
    newAutoOnlyToggle.addEventListener('change', (e) => {
      state.newAutoOnly = e.target.checked;
      renderMagazineGrid();
    });
  }

  document.getElementById('bonusOnlyToggle').addEventListener('change', (e) => {
    state.bonusOnly = e.target.checked;
    renderMagazineGrid();
  });

  document.getElementById('hideSkippedToggle').addEventListener('change', (e) => {
    state.hideSkipped = e.target.checked;
    renderMagazineGrid();
  });

  const isbnLookupForm = document.getElementById('isbnLookupForm');
  if (isbnLookupForm) {
    isbnLookupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('isbnImportInput');
      handleIsbnLookup(input ? input.value : '');
    });
  }

  const isbnPasteBtn = document.getElementById('isbnPasteBtn');
  if (isbnPasteBtn) {
    isbnPasteBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('isbnLookupStatus');
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          throw new Error('no-clipboard-api');
        }
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) {
          if (statusEl) {
            statusEl.className = 'isbn-lookup-status is-error';
            statusEl.textContent = '⚠️ クリップボードが空です。AmazonでURLをコピーしてから押してください。';
          }
          return;
        }
        const input = document.getElementById('isbnImportInput');
        if (input) input.value = text;
        const parsed = parseIncomingSharePayload({ importParam: text });
        if (parsed.mode === 'isbn') {
          await handleIsbnLookup(text);
        } else if (parsed.mode === 'title_only') {
          await processIncomingSharePayload(parsed);
        } else {
          await handleIsbnLookup(text);
        }
      } catch {
        if (statusEl) {
          statusEl.className = 'isbn-lookup-status is-error';
          statusEl.textContent = '⚠️ ブラウザ権限で自動貼付できませんでした。上の入力欄を長押しして「ペースト」してください。';
        }
      }
    });
  }

  const isbnSampleBtn = document.getElementById('isbnSampleBtn');
  if (isbnSampleBtn) {
    isbnSampleBtn.addEventListener('click', () => {
      const input = document.getElementById('isbnImportInput');
      const sampleUrl = 'https://www.amazon.co.jp/dp/4299065921';
      if (input) input.value = sampleUrl;
      handleIsbnLookup(sampleUrl);
    });
  }

  const testShareImportBtn = document.getElementById('testShareImportBtn');
  if (testShareImportBtn) {
    testShareImportBtn.addEventListener('click', () => {
      const demo = parseIncomingSharePayload({
        importParam: 'https://www.amazon.co.jp/dp/4334111920',
        titleParam: '兒玉遥 3rd写真集 You will see | 光文社 | 本 | 通販 | Amazon',
      });
      processIncomingSharePayload(demo, { simulated: true });
    });
  }

  const testShortShareBtn = document.getElementById('testShortShareBtn');
  if (testShortShareBtn) {
    testShortShareBtn.addEventListener('click', () => {
      const demo = parseIncomingSharePayload({
        textParam: '松井珠理奈 2nd写真集『アイヲシル』 https://amzn.asia/d/sampleDemoLink',
      });
      processIncomingSharePayload(demo, { simulated: true });
    });
  }

  const copyBookmarkletBtn = document.getElementById('copyBookmarkletBtn');
  if (copyBookmarkletBtn) {
    copyBookmarkletBtn.addEventListener('click', () => {
      copyTextToClipboard(BOOKMARKLET_CODE, 'Safari/PCブックマークレット');
    });
  }

  const isbnPreviewBox = document.getElementById('isbnPreviewBox');
  if (isbnPreviewBox) {
    isbnPreviewBox.addEventListener('click', (e) => {
      if (e.target.closest('#isbnConfirmImportBtn')) {
        confirmIsbnImport();
      }
    });
    const refreshLiveScore = () => {
      if (!state.isbnLookupPreview) return;
      const slot = document.getElementById('isbnLiveScoreSlot');
      if (!slot) return;
      const { book, extracted } = state.isbnLookupPreview;
      const memoVal = document.getElementById('isbnBonusMemoInput')?.value || '';
      const dateVal = document.getElementById('isbnDateInput')?.value || book.releaseDate || state.referenceDate;
      const draft = buildDraftItemFromOpenBd({ ...book, releaseDate: dateVal }, extracted, memoVal);
      slot.innerHTML = renderIsbnPreviewScoreHtml(draft);
    };
    isbnPreviewBox.addEventListener('input', (e) => {
      if (e.target && (e.target.id === 'isbnBonusMemoInput' || e.target.id === 'isbnDateInput')) {
        refreshLiveScore();
      }
    });
    isbnPreviewBox.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'isbnDateInput') {
        refreshLiveScore();
      }
    });
  }

  const paletteSearchInput = document.getElementById('paletteSearchInput');
  if (paletteSearchInput) {
    paletteSearchInput.addEventListener('input', (e) => {
      state.paletteSearch = e.target.value;
      renderOshiCorner();
    });
  }

  const addVipDirectBtn = document.getElementById('addVipDirectBtn');
  if (addVipDirectBtn) {
    addVipDirectBtn.addEventListener('click', () => {
      const input = document.getElementById('oshiInput');
      const kw = input.value.trim();
      if (!kw) return;
      toggleVipTalent(kw, true);
      input.value = '';
    });
  }

  const exportBackupBtn = document.getElementById('exportBackupBtn');
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', exportUserDataBackup);
  }

  const importBackupInput = document.getElementById('importBackupInput');
  if (importBackupInput) {
    importBackupInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importUserDataBackup(file);
      e.target.value = '';
    });
  }

  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.viewMode;
      renderFilterChips();
      renderMagazineGrid();
    });
  });

  document.getElementById('categoryChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    renderFilterChips();
    renderMagazineGrid();
  });

  document.getElementById('bonusChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bonus]');
    if (!btn) return;
    state.bonusType = btn.dataset.bonus;
    renderFilterChips();
    renderMagazineGrid();
  });

  document.getElementById('storeChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-store]');
    if (!btn) return;
    state.storeFilter = btn.dataset.store;
    renderFilterChips();
    renderMagazineGrid();
  });

  const artworkChips = document.getElementById('artworkChips');
  if (artworkChips) {
    artworkChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-artwork-filter]');
      if (!btn) return;
      state.artworkFilter = btn.dataset.artworkFilter;
      renderFilterChips();
      renderMagazineGrid();
    });
  }

  document.getElementById('statusChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status-filter]');
    if (!btn) return;
    state.statusFilter = btn.dataset.statusFilter;
    renderFilterChips();
    renderMagazineGrid();
  });

  // Delegated input changes (Budget input & Urgent Radar unreserved toggle)
  document.addEventListener('change', (e) => {
    if (e.target && e.target.matches('[data-budget-input]')) {
      setMonthlyBudget(e.target.value);
      return;
    }
    if (e.target && e.target.matches('[data-urgent-unreserved-toggle]')) {
      state.urgentUnreservedOnly = e.target.checked;
      renderUrgentRadar();
    }
  });

  // Global delegated clicks
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop-prop]')) {
      e.stopPropagation();
      return;
    }

    const oshiSubBtn = e.target.closest('[data-oshi-subtab]');
    if (oshiSubBtn) {
      switchOshiSubTab(oshiSubBtn.dataset.oshiSubtab);
      return;
    }

    const jumpIsbnImport = e.target.closest('[data-jump-isbn-import]');
    if (jumpIsbnImport) {
      state.oshiSubTab = 'tools';
      switchTab('oshi');
      const input = document.getElementById('isbnImportInput');
      if (input) {
        setTimeout(() => input.focus(), 120);
      }
      return;
    }

    const jumpOshiCorner = e.target.closest('[data-jump-oshi-corner]');
    if (jumpOshiCorner) {
      state.oshiSubTab = 'oshi';
      switchTab('oshi');
      return;
    }

    const filterOshiDiscover = e.target.closest('[data-filter-oshi-discover]');
    if (filterOshiDiscover) {
      state.oshiOnly = true;
      state.category = 'all';
      renderFilterChips();
      renderMagazineGrid();
      switchTab('discover');
      return;
    }

    const boostBtn = e.target.closest('[data-set-oshi-boost]');
    if (boostBtn) {
      e.stopPropagation();
      setOshiBoostMode(boostBtn.dataset.setOshiBoost);
      return;
    }

    const paletteGrpBtn = e.target.closest('[data-palette-group]');
    if (paletteGrpBtn) {
      state.paletteGroup = paletteGrpBtn.dataset.paletteGroup;
      renderOshiCorner();
      return;
    }

    const toggleOshiBtn = e.target.closest('[data-toggle-oshi]');
    if (toggleOshiBtn) {
      e.stopPropagation();
      toggleOshiKeyword(toggleOshiBtn.dataset.toggleOshi);
      return;
    }

    const toggleVipBtn = e.target.closest('[data-toggle-vip]');
    if (toggleVipBtn) {
      e.stopPropagation();
      toggleVipTalent(toggleVipBtn.dataset.toggleVip);
      return;
    }

    const jumpTabBtn = e.target.closest('[data-jump-tab]');
    if (jumpTabBtn) {
      switchTab(jumpTabBtn.dataset.jumpTab);
      return;
    }

    const urgentRankBtn = e.target.closest('[data-urgent-rank]');
    if (urgentRankBtn) {
      state.urgentRankFilter = urgentRankBtn.dataset.urgentRank;
      renderUrgentRadar();
      return;
    }

    const urgentTopicBtn = e.target.closest('[data-urgent-topic]');
    if (urgentTopicBtn) {
      state.urgentTopicFilter = urgentTopicBtn.dataset.urgentTopic;
      renderUrgentRadar();
      return;
    }

    const quickReserveBtn = e.target.closest('[data-quick-reserve-offer]');
    if (quickReserveBtn) {
      e.stopPropagation();
      setOfferStatus(
        quickReserveBtn.dataset.quickReserveOffer,
        'reserved',
        quickReserveBtn.dataset.quickReserveItem || null
      );
      return;
    }

    const budgetPreset = e.target.closest('[data-budget-preset]');
    if (budgetPreset) {
      setMonthlyBudget(Number(budgetPreset.dataset.budgetPreset));
      return;
    }

    const bulkIcsBtn = e.target.closest('[data-download-bulk-ics]');
    if (bulkIcsBtn) {
      e.stopPropagation();
      downloadBulkReleaseIcs(getUpcomingPlannedEntries());
      return;
    }

    const statusPickerTrigger = e.target.closest('[data-open-status-picker]');
    if (statusPickerTrigger) {
      e.stopPropagation();
      openStatusPicker(
        statusPickerTrigger.dataset.openStatusPicker,
        statusPickerTrigger.dataset.pickerOffer || null
      );
      return;
    }

    const quickPreviewBtn = e.target.closest('[data-quick-preview]');
    if (quickPreviewBtn) {
      e.stopPropagation();
      openQuickPreview(quickPreviewBtn.dataset.quickPreview, 0);
      return;
    }

    const icsBtn = e.target.closest('[data-download-ics]');
    if (icsBtn) {
      e.stopPropagation();
      const item = getItemById(icsBtn.dataset.downloadIcs);
      if (item) downloadReleaseIcs(item);
      return;
    }

    const calMonthBtn = e.target.closest('[data-cal-month]');
    if (calMonthBtn) {
      state.calendarMonth = calMonthBtn.dataset.calMonth;
      renderCalendar();
      return;
    }

    const calSubBtn = e.target.closest('[data-cal-sub]');
    if (calSubBtn) {
      state.calendarSubFilter = calSubBtn.dataset.calSub;
      renderCalendar();
      return;
    }

    const shelfFilterBtn = e.target.closest('[data-shelf-filter]');
    if (shelfFilterBtn) {
      state.shelfFilter = shelfFilterBtn.dataset.shelfFilter;
      renderOshiAndShelf();
      return;
    }

    const itemLightboxBtn = e.target.closest('[data-item-lightbox]');
    if (itemLightboxBtn) {
      e.stopPropagation();
      const item = getItemById(itemLightboxBtn.dataset.itemLightbox);
      if (item) openLightbox(getItemPhotos(item), Number(itemLightboxBtn.dataset.photoIdx) || 0);
      return;
    }

    const wallTile = e.target.closest('[data-wall-photo-idx]');
    if (wallTile) {
      const grid = document.getElementById('magazineGrid');
      if (grid._wallPhotos) openLightbox(grid._wallPhotos, Number(wallTile.dataset.wallPhotoIdx) || 0);
      return;
    }

    const openEl = e.target.closest('[data-open-id]');
    if (openEl) {
      openDetailSheet(openEl.dataset.openId);
      return;
    }

    const removeOshiBtn = e.target.closest('[data-remove-oshi]');
    if (removeOshiBtn) {
      e.stopPropagation();
      const kw = removeOshiBtn.dataset.removeOshi;
      state.oshiKeywords = state.oshiKeywords.filter((item) => item !== kw);
      syncAfterOshiOrVipChange();
      return;
    }

    const copyTextBtn = e.target.closest('[data-copy-text]');
    if (copyTextBtn) {
      e.stopPropagation();
      const val = copyTextBtn.dataset.copyText || '';
      copyTextToClipboard(val, val.length > 26 ? 'ベースURL' : val);
      return;
    }

    const hubSearchTitleBtn = e.target.closest('[data-hub-search-title]');
    if (hubSearchTitleBtn) {
      document.getElementById('hubQueryInput').value = hubSearchTitleBtn.dataset.hubSearchTitle;
      renderHubLauncher();
      switchTab('hub');
      return;
    }

    const hubKwBtn = e.target.closest('[data-hub-kw]');
    if (hubKwBtn) {
      document.getElementById('hubQueryInput').value = hubKwBtn.dataset.hubKw;
      renderHubLauncher();
    }
  });

  document.querySelector('.bottom-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  document.getElementById('oshiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('oshiInput');
    const kw = input.value.trim();
    if (!kw) return;
    toggleOshiKeyword(kw, true);
    input.value = '';
  });

  document.getElementById('manualAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('addTitle').value.trim();
    if (!title) return;
    const talent = document.getElementById('addTalent').value.trim() || '注目タレント';
    const releaseDate = document.getElementById('addDate').value || state.referenceDate;
    const category = document.getElementById('addCategory').value;
    const bonusMemo = document.getElementById('addBonus').value.trim();
    const price = Number(document.getElementById('addPrice').value) || 1000;
    const customAmazonUrl = extractSafeAmazonUrl(document.getElementById('addAmazonUrl')?.value || '');

    const detectedTypes = [];
    if (bonusMemo.includes('ポスター')) detectedTypes.push('poster');
    if (bonusMemo.includes('ポストカード')) detectedTypes.push('postcard');
    if (bonusMemo.includes('生写真') || bonusMemo.includes('ブロマイド')) detectedTypes.push('photo');
    if (bonusMemo.includes('限定表紙')) detectedTypes.push('cover');
    if (bonusMemo.includes('DVD')) detectedTypes.push('dvd');
    if (!detectedTypes.length) detectedTypes.push('standard');

    const links = buildAllStoreSearchLinks(title, true);
    const mentionedStores = [];
    if (/セブン|7net/i.test(bonusMemo)) mentionedStores.push('7net');
    if (/楽天/i.test(bonusMemo)) mentionedStores.push('rakuten');
    if (/hmv|loppi/i.test(bonusMemo)) mentionedStores.push('hmv');
    if (/tsutaya|蔦屋/i.test(bonusMemo)) mentionedStores.push('tsutaya');

    const selectedLinks = links.filter(
      (l) => l.id === 'amazon' || mentionedStores.includes(l.id)
    );

    const ts = Date.now();
    const newItem = {
      id: `custom-${ts}`,
      title,
      series: title.split(/\s+/)[0] || title,
      issueLabel: 'マイ登録',
      publisher: '手動メモ登録',
      category,
      releaseDate,
      price,
      coverTalents: [talent],
      featuredTalents: [talent],
      palette: category === 'r18' ? ['#881337', '#BE123C', '#FFE4E6'] : ['#D92D52', '#FB7185', '#FFE4E6'],
      includedBonuses: bonusMemo.includes('ポスター') ? [{ type: 'poster', label: bonusMemo }] : [],
      printOnlyNote: bonusMemo || '基本購入先：Amazon（他ストアは特典明記時のみ表示）',
      summary: bonusMemo || 'スマホから手動追加した注目タイトル。',
      gallery: [],
      pressArticles: [],
      offers: selectedLinks.map((link) => ({
        id: `custom-offer-${link.id}-${ts}`,
        store: link.id,
        hasStoreExclusiveBonus: link.id !== 'amazon',
        edition: link.id === 'amazon' ? 'Amazon 通常版' : `${link.name} 限定特典`,
        bonusTypes: link.id === 'amazon' ? ['standard'] : detectedTypes,
        bonusText:
          link.id === 'amazon'
            ? `Amazonで「${title}」を確認`
            : bonusMemo || `${link.name}限定特典`,
        talent,
        price,
        status: 'preorder',
        artworkStatus: 'pending',
        url: link.id === 'amazon' && customAmazonUrl ? customAmazonUrl : link.url,
      })),
    };

    state.customItems.unshift(newItem);
    const primaryOffer = newItem.offers.find((o) => o.hasStoreExclusiveBonus) || newItem.offers[0];
    if (primaryOffer) {
      state.offerShelfMap[primaryOffer.id] = 'want';
      saveJson(STORAGE_KEYS.offerShelf, state.offerShelfMap);
    }
    saveJson(STORAGE_KEYS.customItems, state.customItems);

    e.target.reset();
    document.getElementById('addDate').value = '2026-12-01';
    document.getElementById('addPrice').value = '1400';
    renderAll();
    switchTab('discover');
  });

  document.getElementById('hubQueryInput').addEventListener('input', renderHubLauncher);
  document.getElementById('hubBonusOnly').addEventListener('change', renderHubLauncher);

  // Quick Per-Edition Status Picker events
  const statusPickerSheet = document.getElementById('statusPickerSheet');
  document.getElementById('statusPickerCloseBtn').addEventListener('click', closeStatusPicker);
  const doneBtn = document.getElementById('statusPickerDoneBtn');
  if (doneBtn) doneBtn.addEventListener('click', closeStatusPicker);

  statusPickerSheet.addEventListener('click', (e) => {
    if (e.target === statusPickerSheet) closeStatusPicker();
  });

  document.getElementById('statusPickerEditionWrap').addEventListener('click', (e) => {
    const row = e.target.closest('[data-select-picker-offer]');
    if (!row) return;
    state.statusPickerOfferId = row.dataset.selectPickerOffer;
    renderStatusPickerBody();
  });

  document.getElementById('statusPickerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-status]');
    if (!btn || !state.statusPickerItemId) return;
    const item = getItemById(state.statusPickerItemId);
    const visibleOffers = item ? getVisibleOffers(item) : [];
    if (state.statusPickerOfferId) {
      setOfferStatus(state.statusPickerOfferId, btn.dataset.pickStatus, state.statusPickerItemId);
    } else {
      setLegacyItemStatus(state.statusPickerItemId, btn.dataset.pickStatus);
    }
    if (visibleOffers.length <= 1) {
      closeStatusPicker();
    }
  });

  document.getElementById('statusPickerClearBtn').addEventListener('click', () => {
    if (!state.statusPickerItemId) return;
    if (state.statusPickerOfferId) {
      setOfferStatus(state.statusPickerOfferId, '', state.statusPickerItemId);
    } else {
      setLegacyItemStatus(state.statusPickerItemId, '');
    }
  });

  document.getElementById('statusPickerOpenDetailBtn').addEventListener('click', () => {
    const id = state.statusPickerItemId;
    closeStatusPicker();
    if (id) openDetailSheet(id);
  });

  // Detail Sheet interactions
  const sheetBackdrop = document.getElementById('detailSheet');
  document.getElementById('sheetCloseBtn').addEventListener('click', closeDetailSheet);
  sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetBackdrop) closeDetailSheet();
  });

  document.getElementById('sheetBody').addEventListener('click', (e) => {
    const item = getItemById(state.selectedItemId);
    if (!item) return;

    const heroZoom = e.target.closest('[data-hero-zoom]');
    if (heroZoom) {
      openQuickPreview(item.id, 0);
      return;
    }

    const offerStBtn = e.target.closest('[data-set-offer-status]');
    if (offerStBtn) {
      setOfferStatus(offerStBtn.dataset.offerId, offerStBtn.dataset.setOfferStatus, item.id);
      return;
    }

    const statusBtn = e.target.closest('[data-set-status]');
    if (statusBtn) {
      setLegacyItemStatus(item.id, statusBtn.dataset.setStatus);
      return;
    }

    const compareLayoutBtn = e.target.closest('[data-compare-layout]');
    if (compareLayoutBtn) {
      state.offerCompareLayout = compareLayoutBtn.dataset.compareLayout;
      renderDetailSheetBody(item);
      return;
    }

    const offerPhotoBtn = e.target.closest('[data-offer-photo-idx]');
    if (offerPhotoBtn) {
      const body = document.getElementById('sheetBody');
      if (body._offerPhotos) {
        openLightbox(body._offerPhotos, Number(offerPhotoBtn.dataset.offerPhotoIdx) || 0);
      }
      return;
    }

    const offerStoreBtn = e.target.closest('[data-offer-store]');
    if (offerStoreBtn) {
      state.selectedOfferStore = offerStoreBtn.dataset.offerStore;
      renderDetailSheetBody(item);
      return;
    }

    const photoKindBtn = e.target.closest('[data-photo-kind]');
    if (photoKindBtn) {
      state.selectedPhotoKind = photoKindBtn.dataset.photoKind;
      renderDetailSheetBody(item);
      return;
    }

    const thumbBtn = e.target.closest('[data-sheet-photo-idx]');
    if (thumbBtn) {
      const body = document.getElementById('sheetBody');
      if (body._filteredPhotos) {
        openLightbox(body._filteredPhotos, Number(thumbBtn.dataset.sheetPhotoIdx) || 0);
      }
    }
  });

  // Lightbox controls + Touch swipe
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  document.getElementById('photoLightbox').addEventListener('click', (e) => {
    if (e.target.id === 'photoLightbox') {
      closeLightbox();
      return;
    }
    const gotoBtn = e.target.closest('[data-lightbox-goto]');
    if (gotoBtn) {
      state.lightboxIndex = Number(gotoBtn.dataset.lightboxGoto) || 0;
      renderLightbox();
      return;
    }
    const lbStatusBtn = e.target.closest('[data-lightbox-status]');
    if (lbStatusBtn) {
      const offerId = lbStatusBtn.dataset.lightboxOffer;
      const itemId = lbStatusBtn.dataset.lightboxItem;
      if (offerId) {
        setOfferStatus(offerId, lbStatusBtn.dataset.lightboxStatus, itemId);
      } else {
        setLegacyItemStatus(itemId, lbStatusBtn.dataset.lightboxStatus);
      }
    }
  });

  document.getElementById('lightboxPrevBtn').addEventListener('click', () => {
    state.lightboxIndex = (state.lightboxIndex - 1 + state.lightboxPhotos.length) % state.lightboxPhotos.length;
    renderLightbox();
  });
  document.getElementById('lightboxNextBtn').addEventListener('click', () => {
    state.lightboxIndex = (state.lightboxIndex + 1) % state.lightboxPhotos.length;
    renderLightbox();
  });
  document.getElementById('lightboxOpenItemBtn').addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.jumpItemId;
    closeLightbox();
    if (id) openDetailSheet(id);
  });

  let touchStartX = 0;
  const stage = document.getElementById('lightboxStage');
  stage.addEventListener(
    'touchstart',
    (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        touchStartX = e.changedTouches[0].screenX;
      }
    },
    { passive: true }
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      if (!e.changedTouches || !e.changedTouches[0] || state.lightboxPhotos.length <= 1) return;
      const dx = e.changedTouches[0].screenX - touchStartX;
      if (Math.abs(dx) < 42) return;
      if (dx < 0) {
        state.lightboxIndex = (state.lightboxIndex + 1) % state.lightboxPhotos.length;
      } else {
        state.lightboxIndex = (state.lightboxIndex - 1 + state.lightboxPhotos.length) % state.lightboxPhotos.length;
      }
      renderLightbox();
    },
    { passive: true }
  );

  document.addEventListener('keydown', (e) => {
    const lbOpen = document.getElementById('photoLightbox').classList.contains('open');
    if (lbOpen) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') {
        state.lightboxIndex = (state.lightboxIndex - 1 + state.lightboxPhotos.length) % state.lightboxPhotos.length;
        renderLightbox();
      }
      if (e.key === 'ArrowRight') {
        state.lightboxIndex = (state.lightboxIndex + 1) % state.lightboxPhotos.length;
        renderLightbox();
      }
      return;
    }
    if (e.key === 'Escape' && state.statusPickerItemId) {
      closeStatusPicker();
      return;
    }
    if (e.key === 'Escape' && state.selectedItemId) closeDetailSheet();
  });
}

async function init() {
  bindEvents();
  try {
    const res = await fetch('./data/catalog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.baseItems = data.items || [];
    state.referenceDate = data.referenceDate || state.referenceDate;
    state.lastAutoCheckedAt = data.lastAutoCheckedAt || data.updatedAt || '';
    state.autoSources = data.autoSources || null;
    const refShort = state.referenceDate.slice(5).replace('-', '/');
    document.getElementById('referenceDateBadge').textContent = `基準日 ${refShort}`;
    const autoEl = document.getElementById('autoUpdateStatus');
    if (autoEl && state.lastAutoCheckedAt) {
      const checkedLabel = state.lastAutoCheckedAt.slice(0, 16).replace('T', ' ');
      const sourceLabel = state.autoSources?.rakutenApiConnected
        ? '15出版社PR TIMES＋楽天API＋openBD'
        : '15出版社PR TIMES＋openBD';
      autoEl.textContent = `🤖 ${sourceLabel} 自動収集（最終チェック: ${checkedLabel}）`;
    }
  } catch (err) {
    console.error('Failed to load catalog.json:', err);
  }
  renderAll();
  handleIncomingShareFromUrl();
}

init();
