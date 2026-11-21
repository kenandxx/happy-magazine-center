import { createEditorialCoverDataUri, createGalleryPhotoFallbackDataUri } from './cover-art.js';
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
  shelf: 'hmc_shelf_status_v1',
  customItems: 'hmc_custom_items_v1',
};

const SHELF_STATUS_ORDER = [
  'considering',
  'want',
  'reserved_7net',
  'reserved_other',
  'owned',
  'skip',
];

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
    hint: '発売日に買う・予約予定',
    colorClass: 'st-want',
  },
  reserved_7net: {
    icon: '🛒',
    label: '🛒 7net予約済',
    short: '7net予約',
    hint: 'セブンネット等で予約済み',
    colorClass: 'st-reserved',
  },
  reserved_other: {
    icon: '🛍',
    label: '🛍 他店予約済',
    short: '他店予約',
    hint: 'Amazon・楽天・HMVで予約済',
    colorClass: 'st-reserved',
  },
  owned: {
    icon: '✅',
    label: '✅ 購入済',
    short: '購入済',
    hint: '購入・受け取り完了',
    colorClass: 'st-owned',
  },
  skip: {
    icon: '🙅',
    label: '🙅 買わない',
    short: '買わない',
    hint: '見送り（カードを薄く表示）',
    colorClass: 'st-skip',
  },
};

const QUICK_HUB_KEYWORDS = [
  'B.L.T. 2027年1月号',
  'アップトゥボーイ 2027年1月号',
  '小栗有以 2027 カレンダー',
  '沢口愛華 2027 カレンダー',
  '長濱ねる 2027 カレンダー',
  'グラビアアクション vol.1',
  'SPA! 2026年12月16日号',
  'DOLCE Vol.24',
  'BUBKA 2027年1月号',
  'BOMB 2027年1月号',
  'Platinum FLASH Vol.26',
  'ar 2027年1月号',
  'CanCam 2027年1月号',
  'ヤングマガジン',
  '乃木坂46',
  '東雲うみ',
  '一ノ瀬瑠菜',
];

const state = {
  referenceDate: '2026-11-20',
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
  shelfMap: loadJson(STORAGE_KEYS.shelf, {
    'utb-2027-01': 'want',
    'blt-2027-01': 'reserved_7net',
    'gravure-action-1': 'considering',
    'cal-oguri-yui-2027': 'want',
  }),
  activeTab: 'discover',
  viewMode: 'compact', // 'compact' | 'cards' | 'wall'
  offerCompareLayout: 'scroll', // 'scroll' | 'grid'
  search: '',
  category: 'all',
  bonusType: 'all',
  storeFilter: 'all',
  statusFilter: 'all', // 'all' | 'unmarked' | 'considering' | 'want' | 'reserved' | 'owned' | 'skip'
  bonusOnly: false,
  hideSkipped: false,
  sortBy: 'soon',
  calendarMonth: 'upcoming', // 'upcoming' | '2026-11' | '2026-12' | '2027-01' | '2027-02' | 'past'
  calendarSubFilter: 'all', // 'all' | 'marked' | 'bonus' | 'calendar' | 'photobook'
  shelfFilter: 'all', // 'all' | 'considering' | 'want' | 'reserved' | 'owned' | 'skip'
  selectedItemId: null,
  selectedOfferStore: 'all',
  selectedPhotoKind: 'all',
  statusPickerItemId: null,
  lightboxPhotos: [],
  lightboxIndex: 0,
};

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

function getShelfStatus(itemId) {
  const st = state.shelfMap[itemId];
  return st && SHELF_STATUS_META[st] ? st : '';
}

function setShelfStatus(itemId, status) {
  if (!itemId) return;
  if (!status || state.shelfMap[itemId] === status) {
    delete state.shelfMap[itemId];
  } else {
    state.shelfMap[itemId] = status;
  }
  saveJson(STORAGE_KEYS.shelf, state.shelfMap);
  renderFilterChips();
  renderMagazineGrid();
  renderCalendar();
  renderOshiAndShelf();
  if (state.selectedItemId === itemId) {
    const item = getItemById(itemId);
    if (item) renderDetailSheetBody(item);
  }
  if (document.getElementById('photoLightbox').classList.contains('open')) {
    renderLightbox();
  }
}

function getVisibleOffers(item) {
  return (item.offers || []).filter((offer) => {
    if (offer.store === 'amazon') return true;
    return offer.hasStoreExclusiveBonus === true;
  });
}

function getAmazonBasePrice(item) {
  const amazonOffer = getVisibleOffers(item).find((o) => o.store === 'amazon');
  return amazonOffer?.price || item.price || 0;
}

function getItemPhotos(item) {
  const list = [];
  const seenUrls = new Set();
  const amazonBasePrice = getAmazonBasePrice(item);
  const visibleOffers = getVisibleOffers(item);
  const defaultOffer =
    visibleOffers.find((o) => o.hasStoreExclusiveBonus === true) || visibleOffers[0] || null;

  const pushPhoto = (photo) => {
    const key = photo.url || `fallback-${photo.caption}`;
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    list.push({
      itemId: item.id,
      itemTitle: item.title,
      url: photo.url || '',
      caption: photo.caption || item.title,
      source: photo.source || item.publisher || '',
      kind: photo.kind || 'cover',
      tabLabel: photo.tabLabel || PHOTO_KIND_META[photo.kind]?.label || '写真',
      articleUrl: photo.articleUrl || defaultOffer?.url || '#',
      offer: photo.offer || null,
      isPendingArt: Boolean(photo.isPendingArt),
      amazonBasePrice,
      fallbackUri: createGalleryPhotoFallbackDataUri(item, photo),
    });
  };

  for (const g of item.gallery || []) {
    pushPhoto({
      ...g,
      offer: defaultOffer,
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
      url: item.coverImageUrl || coverFallback,
      caption: `${item.title}（${(item.coverTalents || []).join('・')}）`,
      source: item.publisher || '公式書影',
      kind: 'cover',
      tabLabel: '表紙',
      articleUrl: (item.pressArticles && item.pressArticles[0]?.url) || defaultOffer?.url || '#',
      offer: defaultOffer,
      isPendingArt: false,
      amazonBasePrice,
      fallbackUri: coverFallback,
    });
  }

  return list;
}

/**
 * Builds the 1-tap Quick-Check Lightbox slide list for an item:
 * 1) Real cover (with quick buy CTA)
 * 2) Every visible store-bonus offer (real bonus image OR real cover + honest "絵柄解禁待ち" note)
 * 3) All remaining preview cuts / gallery photos
 */
function buildQuickPreviewPhotos(item) {
  const slides = [];
  const seenOfferUrls = new Set();
  const visibleOffers = getVisibleOffers(item);
  const amazonBasePrice = getAmazonBasePrice(item);
  const coverUrl = item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || '';
  const coverFallback = createEditorialCoverDataUri(item);

  // 1) Bonus offers first if they have real artwork, or cover first then offers
  const amazonOffer = visibleOffers.find((o) => o.store === 'amazon') || visibleOffers[0] || null;

  slides.push({
    itemId: item.id,
    itemTitle: item.title,
    url: coverUrl || coverFallback,
    caption: `${item.title}（${(item.coverTalents || []).join('・')}）`,
    source: `${item.publisher || '公式書影'} ・ ${formatDateLabel(item.releaseDate)}`,
    kind: 'cover',
    tabLabel: '📘 表紙',
    articleUrl: amazonOffer?.url || '#',
    offer: amazonOffer,
    isPendingArt: false,
    amazonBasePrice,
    fallbackUri: coverFallback,
  });

  // 2) Store-exclusive bonus variants
  const bonusOffers = visibleOffers.filter((o) => o.hasStoreExclusiveBonus === true);
  bonusOffers.forEach((offer, idx) => {
    const st = STORES[offer.store] || { name: offer.store, shortName: offer.store };
    const kind = (offer.bonusTypes || []).includes('cover') ? 'limited_cover' : 'bonus';
    const hasRealArt = Boolean(offer.imageUrl);
    if (hasRealArt) seenOfferUrls.add(offer.imageUrl);

    slides.push({
      itemId: item.id,
      itemTitle: item.title,
      url: offer.imageUrl || coverUrl || coverFallback,
      caption: `${st.name}｜${offer.edition}：${offer.bonusText}`,
      source: hasRealArt ? `${st.name}（特典絵柄公開済）` : `${st.name}（表紙表示・特典絵柄解禁待ち）`,
      kind,
      tabLabel: `${hasRealArt ? '✨' : '🎁'}${st.shortName}${bonusOffers.length > 1 ? idx + 1 : ''}`,
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

  // 3) Additional gallery cuts (skip duplicates of cover or offer art)
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

function itemMatchesOshi(item) {
  if (!state.oshiKeywords.length) return [];
  const haystack = [
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

  return state.oshiKeywords.filter((kw) => haystack.includes(kw.toLowerCase()));
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

function matchesStatusBucket(itemStatus, filterKey) {
  if (filterKey === 'all') return true;
  if (filterKey === 'unmarked') return !itemStatus;
  if (filterKey === 'reserved') {
    return itemStatus === 'reserved_7net' || itemStatus === 'reserved_other';
  }
  return itemStatus === filterKey;
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

    const itemStatus = getShelfStatus(item.id);
    if (state.hideSkipped && itemStatus === 'skip' && state.statusFilter !== 'skip') return false;
    if (!matchesStatusBucket(itemStatus, state.statusFilter)) return false;

    if (state.bonusOnly && getItemSpecialBonusCount(item) === 0) return false;

    if (q) {
      const text = [
        item.title,
        item.series,
        item.publisher,
        item.summary,
        item.releaseDate,
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
    const aSkip = getShelfStatus(a.id) === 'skip' ? 1 : 0;
    const bSkip = getShelfStatus(b.id) === 'skip' ? 1 : 0;
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

function renderPhotoImg(photo, className = '') {
  const src = photo.url || photo.fallbackUri;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(
    photo.caption
  )}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${photo.fallbackUri}';" />`;
}

function renderStatusMarkButton(itemId, compact = false) {
  const st = getShelfStatus(itemId);
  if (!st) {
    return `<button
      class="status-mark-btn is-unmarked"
      type="button"
      data-open-status-picker="${escapeHtml(itemId)}"
      aria-label="ステータスをマーク"
      title="検討中・買う予定・買わないをマーク"
    >${compact ? '🏷＋' : '🏷 マーク'}</button>`;
  }
  const meta = SHELF_STATUS_META[st];
  return `<button
    class="status-mark-btn ${meta.colorClass}"
    type="button"
    data-open-status-picker="${escapeHtml(itemId)}"
    aria-label="ステータス変更：${escapeHtml(meta.label)}"
    title="${escapeHtml(meta.label)}（タップで変更）"
  >${meta.icon}${compact ? '' : ' '}${escapeHtml(meta.short)}</button>`;
}

function renderCountdownStrip() {
  const container = document.getElementById('countdownStrip');
  const upcoming = getAllItems()
    .filter((item) => diffDays(item.releaseDate) >= 0 && getShelfStatus(item.id) !== 'skip')
    .sort((a, b) => diffDays(a.releaseDate) - diffDays(b.releaseDate))
    .slice(0, 10);

  container.innerHTML = upcoming
    .map((item) => {
      const cd = formatCountdown(item.releaseDate);
      const specialCount = getItemSpecialBonusCount(item);
      const st = getShelfStatus(item.id);
      const stIcon = st ? `${SHELF_STATUS_META[st].icon} ` : '';
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
    const st = getShelfStatus(it.id);
    if (!st) statusCounts.unmarked += 1;
    else if (st === 'reserved_7net' || st === 'reserved_other') statusCounts.reserved += 1;
    else if (statusCounts[st] !== undefined) statusCounts[st] += 1;
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
      return `
        <article class="wall-tile" data-wall-photo-idx="${idx}">
          <div class="wall-photo-box">
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
      const shelfStatus = getShelfStatus(item.id);
      const photos = getItemPhotos(item);
      const visibleOffers = getVisibleOffers(item);
      const bonusOffersCount = visibleOffers.filter((o) => o.hasStoreExclusiveBonus === true).length;

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

      const dateShort = item.releaseDate.slice(5).replace('-', '/');

      return `
        <article class="compact-card ${oshiHits.length ? 'oshi-match' : ''} ${
        shelfStatus === 'skip' ? 'is-skipped' : ''
      }" data-open-id="${escapeHtml(item.id)}">
          <div class="compact-cover-box">
            ${renderPhotoImg(photos[0])}
            <div class="compact-top-bar">
              <span class="compact-cd-pill ${cd.type === 'today' ? 'is-today' : ''}">${
                cd.type === 'today' ? '本日発売' : `${dateShort} ${cd.text}`
              }</span>
              <div class="compact-top-right">
                ${renderStatusMarkButton(item.id, true)}
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
              ${
                item.category === 'calendar'
                  ? `<span class="compact-store-pill" style="background:#312e81;color:#fff;">🗓カレンダー</span>`
                  : ''
              }
              ${oshiHits.length ? `<span class="compact-store-pill" style="background:var(--accent);color:#fff;">🔥${escapeHtml(oshiHits[0])}</span>` : ''}
              ${storeBadges}
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
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <strong>条件に合う雑誌・写真集・カレンダーがありません</strong>
        <p>${
          q
            ? `「${escapeHtml(q)}」をセブンネット・楽天ブックス・HMV・Amazonで横断検索してみましょう！`
            : 'フィルターを緩めるか、「横断検索」タブから任意のタイトルを探せます。'
        }</p>
        <button class="primary-btn" type="button" id="jumpToHubBtn">⚡ 全ストア横断検索へ</button>
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
      const shelfStatus = getShelfStatus(item.id);
      const bonusTypes = getItemBonusTypes(item);
      const photos = getItemPhotos(item);
      const pressCount = (item.pressArticles || []).length;

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
                    class="strip-thumb-btn"
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
        shelfStatus === 'skip' ? 'is-skipped' : ''
      }">
          <div class="mag-card-top" data-open-id="${escapeHtml(item.id)}">
            <div class="cover-wrap">
              ${renderCoverImg(item)}
              <span class="cover-date-tag ${cd.type === 'today' ? 'is-today' : ''}">
                ${escapeHtml(item.releaseDate.slice(5).replace('-', '/'))} ・ ${escapeHtml(cd.text)}
              </span>
            </div>

            <div class="mag-info">
              <div class="meta-top-row">
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  <span class="cat-badge">${escapeHtml(CATEGORY_META[item.category]?.label || '雑誌')}</span>
                  ${oshiHits.length ? `<span class="oshi-badge">🔥 ${escapeHtml(oshiHits[0])}</span>` : ''}
                </div>
                ${renderStatusMarkButton(item.id, false)}
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

function getMonthRoadmapBuckets(items) {
  const upcomingItems = items.filter((it) => diffDays(it.releaseDate) >= 0);
  const pastItems = items.filter((it) => diffDays(it.releaseDate) < 0);

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
    const bonusCount = b.items.filter((it) => getItemSpecialBonusCount(it) > 0).length;
    const markedPlanned = b.items.filter((it) => {
      const st = getShelfStatus(it.id);
      return st === 'want' || st === 'reserved_7net' || st === 'reserved_other';
    });
    const consideringCount = b.items.filter((it) => getShelfStatus(it.id) === 'considering').length;
    const plannedYen = markedPlanned.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
    return {
      ...b,
      bonusCount,
      plannedCount: markedPlanned.length,
      consideringCount,
      plannedYen,
    };
  });
}

function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const allItems = getAllItems();
  const buckets = getMonthRoadmapBuckets(allItems);

  // Pick "Your Next Upcoming Treat" hero item
  const upcomingSorted = allItems
    .filter((it) => diffDays(it.releaseDate) >= 0 && getShelfStatus(it.id) !== 'skip')
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

  const heroItem =
    upcomingSorted.find((it) => {
      const st = getShelfStatus(it.id);
      return st === 'want' || st === 'reserved_7net' || st === 'reserved_other' || st === 'considering';
    }) ||
    upcomingSorted.find((it) => getItemSpecialBonusCount(it) > 0) ||
    upcomingSorted[0] ||
    null;

  let heroHtml = '';
  if (heroItem) {
    const cd = formatCountdown(heroItem.releaseDate);
    const st = getShelfStatus(heroItem.id);
    const stText = st ? SHELF_STATUS_META[st].label : '🎁 注目リリース';
    const topBonus =
      getVisibleOffers(heroItem).find((o) => o.hasStoreExclusiveBonus === true)?.bonusText ||
      heroItem.includedBonuses?.[0]?.label ||
      heroItem.summary ||
      '';
    heroHtml = `
      <div class="excitement-hero">
        ${renderCoverImg(heroItem, 'excitement-hero-thumb')}
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
              📅 カレンダー登録
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Roadmap cards
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
          <span class="month-pill-stats">${b.items.length}冊 ・ 🎁${b.bonusCount}</span>
          <span class="month-pill-budget">${
            b.plannedCount > 0
              ? `👀${b.plannedCount}冊 ¥${b.plannedYen.toLocaleString()}`
              : b.consideringCount > 0
                ? `🤔検討中 ${b.consideringCount}冊`
                : 'まだ未マーク'
          }</span>
        </button>
      `
        )
        .join('')}
    </div>
  `;

  // Sub-filter row
  const subChoices = [
    { id: 'all', label: 'すべて表示' },
    { id: 'marked', label: '💖 予定・検討中のみ' },
    { id: 'bonus', label: '🎁 限定特典あり' },
    { id: 'calendar', label: '🗓 カレンダー' },
    { id: 'photobook', label: '📸 写真集' },
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
      const st = getShelfStatus(it.id);
      return st === 'want' || st === 'considering' || st === 'reserved_7net' || st === 'reserved_other';
    });
  } else if (state.calendarSubFilter === 'bonus') {
    listItems = listItems.filter((it) => getItemSpecialBonusCount(it) > 0);
  } else if (state.calendarSubFilter === 'calendar') {
    listItems = listItems.filter((it) => it.category === 'calendar');
  } else if (state.calendarSubFilter === 'photobook') {
    listItems = listItems.filter((it) => it.category === 'photobook');
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
                    const status = getShelfStatus(item.id);
                    const catLabel = CATEGORY_META[item.category]?.label || '雑誌';
                    return `
                      <div class="timeline-item ${status === 'skip' ? 'is-skipped' : ''}" data-open-id="${escapeHtml(item.id)}">
                        ${renderCoverImg(item, 'timeline-thumb')}
                        <div class="timeline-body">
                          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:3px;">
                            <span class="cat-badge">${escapeHtml(catLabel)}</span>
                            ${
                              specialCount > 0
                                ? `<span class="oshi-badge">🎁 特典${specialCount}</span>`
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
                          ${renderStatusMarkButton(item.id, false)}
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

  container.innerHTML = `${heroHtml}${roadmapHtml}${subFilterHtml}${timelineHtml}`;
}

function renderOshiAndShelf() {
  const cloud = document.getElementById('oshiTagCloud');
  cloud.innerHTML = state.oshiKeywords.length
    ? state.oshiKeywords
        .map(
          (kw) => `
          <span class="oshi-tag">
            <span>🔥 ${escapeHtml(kw)}</span>
            <button type="button" data-remove-oshi="${escapeHtml(kw)}" aria-label="${escapeHtml(kw)}を削除">×</button>
          </span>
        `
        )
        .join('')
    : '<span style="font-size:12px;color:var(--ink-muted);">まだ推しワードが登録されていません。</span>';

  const itemsById = new Map(getAllItems().map((item) => [item.id, item]));
  const trackedEntries = Object.entries(state.shelfMap)
    .map(([id, status]) => ({ item: itemsById.get(id), status }))
    .filter((entry) => Boolean(entry.item) && Boolean(SHELF_STATUS_META[entry.status]));

  const countByBucket = {
    all: trackedEntries.length,
    considering: trackedEntries.filter((e) => e.status === 'considering').length,
    want: trackedEntries.filter((e) => e.status === 'want').length,
    reserved: trackedEntries.filter(
      (e) => e.status === 'reserved_7net' || e.status === 'reserved_other'
    ).length,
    owned: trackedEntries.filter((e) => e.status === 'owned').length,
    skip: trackedEntries.filter((e) => e.status === 'skip').length,
  };

  const cornerTiles = [
    { id: 'all', icon: '🏷', label: 'マーク全体', count: countByBucket.all },
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
    .filter((e) => e.status === 'want' || e.status === 'reserved_7net' || e.status === 'reserved_other')
    .reduce((sum, e) => sum + (Number(e.item.price) || 0), 0);
  const consideringYen = trackedEntries
    .filter((e) => e.status === 'considering')
    .reduce((sum, e) => sum + (Number(e.item.price) || 0), 0);

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
      <div class="stat-val">${trackedEntries.length} / ${getAllItems().length}</div>
      <div class="stat-label">判定済み作品</div>
    </div>
  `;

  const visibleEntries = trackedEntries
    .filter((e) => matchesStatusBucket(e.status, state.shelfFilter))
    .sort((a, b) => new Date(a.item.releaseDate) - new Date(b.item.releaseDate));

  const shelfList = document.getElementById('shelfList');
  if (!visibleEntries.length) {
    shelfList.innerHTML =
      '<p style="font-size:12px;color:var(--ink-muted);margin:0;">このステータスの作品はまだありません。各カードの「🏷 マーク」からワンタップで仕分けできます。</p>';
    return;
  }

  shelfList.innerHTML = visibleEntries
    .map(({ item, status }) => {
      const cd = formatCountdown(item.releaseDate);
      return `
        <div class="timeline-item ${status === 'skip' ? 'is-skipped' : ''}" data-open-id="${escapeHtml(item.id)}">
          ${renderCoverImg(item, 'timeline-thumb')}
          <div class="timeline-body">
            <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
            <p class="timeline-sub">${escapeHtml(formatDateLabel(item.releaseDate))}（${escapeHtml(cd.text)}） ・ ¥${(
              item.price || 0
            ).toLocaleString()}</p>
          </div>
          <div class="timeline-actions">
            ${renderStatusMarkButton(item.id, false)}
            <button class="quick-preview-icon-btn" type="button" data-quick-preview="${escapeHtml(item.id)}">
              🔍 確認
            </button>
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
   Quick 1-Tap Status Picker Sheet
   ========================================================= */
function openStatusPicker(itemId) {
  const item = getItemById(itemId);
  if (!item) return;

  state.statusPickerItemId = itemId;
  const currentStatus = getShelfStatus(itemId);

  document.getElementById('statusPickerItemMeta').innerHTML = `
    ${renderCoverImg(item, 'quick-status-thumb')}
    <div style="min-width:0;">
      <h3 id="statusPickerTitle" class="quick-status-item-title">${escapeHtml(item.title)}</h3>
      <div class="quick-status-item-sub">${escapeHtml(formatDateLabel(item.releaseDate))} ・ ¥${(
        item.price || 0
      ).toLocaleString()}</div>
    </div>
  `;

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
  document.getElementById('statusPickerSheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeStatusPicker() {
  state.statusPickerItemId = null;
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

  // Slide switcher pills
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

  // 1-Tap Offer & Direct Buy CTA bar
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

  // 1-Tap Quick Status Bar inside Lightbox
  const statusBar = document.getElementById('lightboxStatusBar');
  if (photo.itemId) {
    const currentStatus = getShelfStatus(photo.itemId);
    const quickKeys = ['considering', 'want', 'reserved_7net', 'owned', 'skip'];
    statusBar.style.display = 'flex';
    statusBar.innerHTML = quickKeys
      .map((key) => {
        const meta = SHELF_STATUS_META[key];
        return `
          <button
            class="lightbox-status-btn ${currentStatus === key ? 'active' : ''}"
            type="button"
            data-lightbox-status="${key}"
            data-lightbox-item="${escapeHtml(photo.itemId)}"
          >${meta.icon} ${escapeHtml(meta.short)}</button>
        `;
      })
      .join('');
  } else {
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
   .ics Release Calendar Reminder Download
   ========================================================= */
function escapeIcsText(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadReleaseIcs(item) {
  if (!item || !item.releaseDate) return;
  const start = item.releaseDate.replace(/-/g, '');
  const nextDayObj = new Date(`${item.releaseDate}T00:00:00`);
  nextDayObj.setDate(nextDayObj.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const end = `${nextDayObj.getFullYear()}${pad(nextDayObj.getMonth() + 1)}${pad(nextDayObj.getDate())}`;

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

  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Happy Magazine Center//Release Reminder//JA',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${item.id}@happy-magazine-center`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeIcsText(`【発売】${item.title}`)}`,
    `DESCRIPTION:${escapeIcsText(desc)}`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`明日発売：${item.title}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `release-${item.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const currentStatus = getShelfStatus(item.id);
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

  const officialSns = getOfficialSnsForItem(item);
  const talentPromos = buildTalentPromoLinks(item);
  const pressArticles = item.pressArticles || [];
  const itemCoverFallback = item.coverImageUrl || (item.gallery && item.gallery[0]?.url) || '';

  const body = document.getElementById('sheetBody');
  body.innerHTML = `
    <div class="sheet-hero">
      <button class="sheet-cover-btn" type="button" data-hero-zoom="${escapeHtml(item.id)}" aria-label="表紙と特典写真を拡大確認">
        ${renderCoverImg(item, 'sheet-cover')}
        <span class="sheet-cover-zoom-badge">🔍 拡大(${quickPreviewCount}枚)</span>
      </button>
      <div class="sheet-meta">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <span class="cat-badge">${escapeHtml(CATEGORY_META[item.category]?.label || '雑誌')}</span>
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
      </div>
    </div>

    ${renderBonusDigestHtml(item, visibleOffers, amazonBasePrice)}

    ${
      item.printOnlyNote
        ? `<div style="font-size:11px;color:var(--ink-secondary);background:var(--bg);padding:8px 10px;border-radius:10px;margin-bottom:10px;">
            ℹ️ ${escapeHtml(item.printOnlyNote)}
          </div>`
        : ''
    }

    <div class="status-selector" aria-label="マイステータス">
      ${SHELF_STATUS_ORDER.map((key) => {
        const meta = SHELF_STATUS_META[key];
        return `
        <button
          class="status-btn ${meta.colorClass} ${currentStatus === key ? 'active' : ''}"
          type="button"
          data-set-status="${key}"
        >${meta.icon} ${escapeHtml(meta.short)}</button>
      `;
      }).join('')}
    </div>

    <!-- Section 1: Side-by-Side Visual Bonus Variant Comparator -->
    <div class="sheet-section">
      <div class="compare-header-bar">
        <div class="sheet-section-title" style="margin:0;">
          <span>🎁 特典絵柄・店舗 横並び比較（${offers.length}種）</span>
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
        ※ Amazon（基本購入先）と限定特典ありストアのみ表示。絵柄タップで拡大＋そのまま購入＆マークできます。
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
            url: offer.imageUrl || itemCoverFallback || '',
            caption: `${st.name}｜${offer.edition}：${offer.bonusText}`,
            source: hasRealArt
              ? `${st.name}（特典絵柄公開済）`
              : offer.store === 'amazon'
                ? `${st.name}（表紙）`
                : `${st.name}（表紙表示・特典絵柄解禁待ち）`,
            kind,
            tabLabel: `${hasRealArt ? '✨' : '📘'}${st.shortName}${offers.length > 1 ? idx + 1 : ''}`,
            articleUrl: offer.url,
            offer,
            isPendingArt: !hasRealArt && offer.hasStoreExclusiveBonus === true,
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
                ? `<span class="compare-art-badge">✨ 特典絵柄</span>`
                : offer.store === 'amazon'
                  ? `<span class="compare-art-badge is-pending">📘 表紙</span>`
                  : `<span class="compare-art-badge is-pending">📘 表紙・絵柄待ち</span>`;

              return `
                <article class="compare-card ${offer.hasStoreExclusiveBonus ? 'is-bonus' : ''}">
                  <button class="compare-img-btn" type="button" data-offer-photo-idx="${idx}" aria-label="${escapeHtml(offer.edition)}を拡大">
                    ${renderPhotoImg(offerPhotos[idx])}
                    <span class="compare-store-float ${store.badgeClass}">${escapeHtml(store.shortName)}</span>
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
                <div class="gallery-thumb-img-wrap">
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

  if (tabId === 'calendar') renderCalendar();
  if (tabId === 'oshi') renderOshiAndShelf();
  if (tabId === 'hub') renderHubLauncher();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAll() {
  renderCountdownStrip();
  renderFilterChips();
  renderMagazineGrid();
  renderCalendar();
  renderOshiAndShelf();
  renderHubLauncher();
}

function bindEvents() {
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

  document.getElementById('bonusOnlyToggle').addEventListener('change', (e) => {
    state.bonusOnly = e.target.checked;
    renderMagazineGrid();
  });

  document.getElementById('hideSkippedToggle').addEventListener('change', (e) => {
    state.hideSkipped = e.target.checked;
    renderMagazineGrid();
  });

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

  document.getElementById('statusChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status-filter]');
    if (!btn) return;
    state.statusFilter = btn.dataset.statusFilter;
    renderFilterChips();
    renderMagazineGrid();
  });

  // Global delegated clicks
  document.addEventListener('click', (e) => {
    const statusPickerTrigger = e.target.closest('[data-open-status-picker]');
    if (statusPickerTrigger) {
      e.stopPropagation();
      openStatusPicker(statusPickerTrigger.dataset.openStatusPicker);
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
      const kw = removeOshiBtn.dataset.removeOshi;
      state.oshiKeywords = state.oshiKeywords.filter((item) => item !== kw);
      saveJson(STORAGE_KEYS.oshi, state.oshiKeywords);
      renderOshiAndShelf();
      renderMagazineGrid();
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
    if (!state.oshiKeywords.includes(kw)) {
      state.oshiKeywords.unshift(kw);
      saveJson(STORAGE_KEYS.oshi, state.oshiKeywords);
    }
    input.value = '';
    renderOshiAndShelf();
    renderMagazineGrid();
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

    const newItem = {
      id: `custom-${Date.now()}`,
      title,
      series: title.split(/\s+/)[0] || title,
      issueLabel: 'マイ登録',
      publisher: '手動メモ登録',
      category,
      releaseDate,
      price,
      coverTalents: [talent],
      featuredTalents: [talent],
      palette: ['#D92D52', '#FB7185', '#FFE4E6'],
      includedBonuses: bonusMemo.includes('ポスター') ? [{ type: 'poster', label: bonusMemo }] : [],
      printOnlyNote: bonusMemo || '基本購入先：Amazon（他ストアは特典明記時のみ表示）',
      summary: bonusMemo || 'スマホから手動追加した注目タイトル。',
      gallery: [],
      pressArticles: [],
      offers: selectedLinks.map((link) => ({
        id: `custom-offer-${link.id}-${Date.now()}`,
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
        url: link.url,
      })),
    };

    state.customItems.unshift(newItem);
    state.shelfMap[newItem.id] = 'want';
    saveJson(STORAGE_KEYS.customItems, state.customItems);
    saveJson(STORAGE_KEYS.shelf, state.shelfMap);

    e.target.reset();
    document.getElementById('addDate').value = '2026-12-01';
    document.getElementById('addPrice').value = '1400';
    renderAll();
    switchTab('discover');
  });

  document.getElementById('hubQueryInput').addEventListener('input', renderHubLauncher);
  document.getElementById('hubBonusOnly').addEventListener('change', renderHubLauncher);

  // Quick Status Picker events
  const statusPickerSheet = document.getElementById('statusPickerSheet');
  document.getElementById('statusPickerCloseBtn').addEventListener('click', closeStatusPicker);
  statusPickerSheet.addEventListener('click', (e) => {
    if (e.target === statusPickerSheet) closeStatusPicker();
  });
  document.getElementById('statusPickerGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-status]');
    if (!btn || !state.statusPickerItemId) return;
    setShelfStatus(state.statusPickerItemId, btn.dataset.pickStatus);
    closeStatusPicker();
  });
  document.getElementById('statusPickerClearBtn').addEventListener('click', () => {
    if (!state.statusPickerItemId) return;
    setShelfStatus(state.statusPickerItemId, '');
    closeStatusPicker();
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

    const statusBtn = e.target.closest('[data-set-status]');
    if (statusBtn) {
      setShelfStatus(item.id, statusBtn.dataset.setStatus);
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
      setShelfStatus(lbStatusBtn.dataset.lightboxItem, lbStatusBtn.dataset.lightboxStatus);
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

  // Smartphone swipe support on Lightbox stage
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
    const refShort = state.referenceDate.slice(5).replace('-', '/');
    document.getElementById('referenceDateBadge').textContent = `基準日 ${refShort}`;
  } catch (err) {
    console.error('Failed to load catalog.json:', err);
  }
  renderAll();
}

init();
