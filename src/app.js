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

const SHELF_STATUS_META = {
  want: { label: '👀 気になる', short: '気になる' },
  reserved_7net: { label: '🛒 セブン予約済', short: 'セブン予約' },
  reserved_other: { label: '🛒 他ストア予約済', short: '他ストア予約' },
  owned: { label: '✅ 購入済', short: '購入済' },
};

const QUICK_HUB_KEYWORDS = [
  'グラビアアクション vol.1',
  'SPA! 2026年12月16日号',
  'DOLCE Vol.24',
  'ENTAME36℃ vol.08',
  'グラビアプレス Vol.23',
  'Platinum FLASH Vol.26',
  'B.L.T. 2027年1月号',
  'アップトゥボーイ 2027年1月号',
  'BUBKA 2027年1月号',
  'BOMB 2027年1月号',
  'EX大衆 2026年12月号',
  'ar 2027年1月号',
  'CanCam 2027年1月号',
  'ヤングマガジン',
  'ヤングジャンプ',
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
    'gravure-action-1': 'want',
  }),
  activeTab: 'discover',
  viewMode: 'compact', // 'compact' | 'cards' | 'wall'
  offerCompareLayout: 'scroll', // 'scroll' | 'grid'
  search: '',
  category: 'all',
  bonusType: 'all',
  storeFilter: 'all',
  bonusOnly: false,
  sortBy: 'soon',
  selectedItemId: null,
  selectedOfferStore: 'all',
  selectedPhotoKind: 'all',
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

function diffDays(dateStr, refDateStr = state.referenceDate) {
  const target = new Date(`${dateStr}T00:00:00`);
  const ref = new Date(`${refDateStr}T00:00:00`);
  return Math.round((target - ref) / (1000 * 60 * 60 * 24));
}

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function formatCountdown(dateStr) {
  const diff = diffDays(dateStr);
  if (diff === 0) return { text: '本日発売！', type: 'today', days: 0 };
  if (diff > 0) return { text: `あと${diff}日`, type: 'upcoming', days: diff };
  return { text: `${Math.abs(diff)}日前発売`, type: 'past', days: diff };
}

function getItemPhotos(item) {
  const list = [];
  const seenUrls = new Set();

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
      articleUrl: photo.articleUrl || (item.offers && item.offers[0] ? item.offers[0].url : '#'),
      fallbackUri: createGalleryPhotoFallbackDataUri(item, photo),
    });
  };

  for (const g of item.gallery || []) {
    pushPhoto(g);
  }

  for (const offer of item.offers || []) {
    if (offer.imageUrl) {
      pushPhoto({
        url: offer.imageUrl,
        caption: `${STORES[offer.store]?.name || offer.store}：${offer.bonusText}`,
        source: STORES[offer.store]?.name || offer.store,
        kind: (offer.bonusTypes || []).includes('cover') ? 'limited_cover' : 'bonus',
        articleUrl: offer.url,
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
      articleUrl: (item.pressArticles && item.pressArticles[0]?.url) || (item.offers && item.offers[0]?.url) || '#',
      fallbackUri: coverFallback,
    });
  }

  return list;
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

function getVisibleOffers(item) {
  return (item.offers || []).filter((offer) => {
    if (offer.store === 'amazon') return true;
    return offer.hasStoreExclusiveBonus === true;
  });
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

function renderCountdownStrip() {
  const container = document.getElementById('countdownStrip');
  const upcoming = getAllItems()
    .filter((item) => diffDays(item.releaseDate) >= 0)
    .sort((a, b) => diffDays(a.releaseDate) - diffDays(b.releaseDate))
    .slice(0, 8);

  container.innerHTML = upcoming
    .map((item) => {
      const cd = formatCountdown(item.releaseDate);
      const specialCount = getItemSpecialBonusCount(item);
      const photoCount = getItemPhotos(item).length;
      return `
        <button class="countdown-chip" type="button" data-open-id="${escapeHtml(item.id)}">
          <span class="countdown-days ${cd.type === 'today' ? 'today' : ''}">${escapeHtml(cd.text)}</span>
          <div class="countdown-meta">
            <div class="countdown-title">${escapeHtml(item.title)}</div>
            <div class="countdown-sub">${escapeHtml(formatDateLabel(item.releaseDate))} ・ 📷${photoCount} ・ 🎁${specialCount}</div>
          </div>
        </button>
      `;
    })
    .join('');
}

function renderFilterChips() {
  document.getElementById('categoryChips').innerHTML = Object.entries(CATEGORY_META)
    .map(
      ([id, meta]) => `
      <button class="filter-chip ${state.category === id ? 'active' : ''}" type="button" data-cat="${id}">
        ${escapeHtml(meta.label)}
      </button>
    `
    )
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
    { id: 'all', label: '🏪 すべて' },
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
      const shelfStatus = state.shelfMap[item.id];
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
        <article class="compact-card ${oshiHits.length ? 'oshi-match' : ''}" data-open-id="${escapeHtml(item.id)}">
          <div class="compact-cover-box">
            ${renderPhotoImg(photos[0])}
            <div class="compact-top-bar">
              <span class="compact-cd-pill ${cd.type === 'today' ? 'is-today' : ''}">${
                cd.type === 'today' ? '本日発売' : `${dateShort} ${cd.text}`
              }</span>
              <div class="compact-top-right">
                ${photos.length > 1 ? `<span class="compact-photo-pill">📷${photos.length}</span>` : ''}
                <button
                  class="compact-fav-btn"
                  type="button"
                  data-quick-fav="${escapeHtml(item.id)}"
                  aria-label="お気に入り切替"
                >${shelfStatus ? '★' : '☆'}</button>
              </div>
            </div>
            <div class="compact-bottom-scrim">
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
        <strong>条件に合う雑誌・写真集が一覧にありません</strong>
        <p>${
          q
            ? `「${escapeHtml(q)}」をセブンネット・楽天ブックス・HMV・Amazonで横断検索してみましょう！`
            : 'フィルターを緩めるか、「横断検索」タブから任意の雑誌を探せます。'
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
      const shelfStatus = state.shelfMap[item.id];
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
              <button class="strip-count-pill" type="button" data-open-id="${escapeHtml(item.id)}">
                📷 写真${photos.length}枚${pressCount ? ` ＋ 先行記事${pressCount}` : ''}
              </button>
            </div>`
          : '';

      return `
        <article class="mag-card ${oshiHits.length ? 'oshi-match' : ''}">
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
                <button
                  class="fav-icon-btn"
                  type="button"
                  data-quick-fav="${escapeHtml(item.id)}"
                  aria-label="お気に入り切替"
                  title="${shelfStatus ? SHELF_STATUS_META[shelfStatus].label : '気になるに追加'}"
                >${shelfStatus ? '★' : '☆'}</button>
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
              <button class="detail-trigger-btn" type="button" data-open-id="${escapeHtml(item.id)}">
                写真・購入
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  const sorted = [...getAllItems()].sort(
    (a, b) => new Date(a.releaseDate) - new Date(b.releaseDate)
  );

  const grouped = new Map();
  for (const item of sorted) {
    if (!grouped.has(item.releaseDate)) grouped.set(item.releaseDate, []);
    grouped.get(item.releaseDate).push(item);
  }

  const upcomingDates = [...grouped.keys()].filter((d) => diffDays(d) >= 0);
  const pastDates = [...grouped.keys()].filter((d) => diffDays(d) < 0).reverse();
  const orderedDates = [...upcomingDates, ...pastDates];

  container.innerHTML = orderedDates
    .map((dateStr) => {
      const cd = formatCountdown(dateStr);
      const list = grouped.get(dateStr);
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
                const status = state.shelfMap[item.id];
                return `
                  <div class="timeline-item" data-open-id="${escapeHtml(item.id)}">
                    ${renderCoverImg(item, 'timeline-thumb')}
                    <div class="timeline-body">
                      <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
                      <p class="timeline-sub">
                        ${escapeHtml((item.coverTalents || []).join('・'))}
                        ／ 📷${photoCount}枚 ・ 🎁${specialCount}件
                      </p>
                      ${
                        status
                          ? `<span class="oshi-badge" style="margin-top:4px;display:inline-block;">${escapeHtml(
                              SHELF_STATUS_META[status].label
                            )}</span>`
                          : ''
                      }
                    </div>
                    <span class="detail-trigger-btn">詳細</span>
                  </div>
                `;
              })
              .join('')}
          </div>
        </section>
      `;
    })
    .join('');
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
    .filter((entry) => Boolean(entry.item));

  const reservedCount = trackedEntries.filter(
    (e) => e.status === 'reserved_7net' || e.status === 'reserved_other'
  ).length;
  const wantCount = trackedEntries.filter((e) => e.status === 'want').length;
  const estimatedYen = trackedEntries
    .filter((e) => e.status !== 'owned')
    .reduce((sum, e) => sum + (Number(e.item.price) || 0), 0);

  document.getElementById('shelfStats').innerHTML = `
    <div class="stat-box">
      <div class="stat-val">${wantCount}</div>
      <div class="stat-label">気になる</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">${reservedCount}</div>
      <div class="stat-label">予約済み</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">¥${estimatedYen.toLocaleString()}</div>
      <div class="stat-label">購入予定合計</div>
    </div>
  `;

  const shelfList = document.getElementById('shelfList');
  if (!trackedEntries.length) {
    shelfList.innerHTML =
      '<p style="font-size:12px;color:var(--ink-muted);margin:0;">まだ登録されていません。気になる雑誌の ☆ ボタンや詳細画面から登録できます。</p>';
    return;
  }

  shelfList.innerHTML = trackedEntries
    .map(({ item, status }) => {
      const cd = formatCountdown(item.releaseDate);
      return `
        <div class="timeline-item" data-open-id="${escapeHtml(item.id)}">
          ${renderCoverImg(item, 'timeline-thumb')}
          <div class="timeline-body">
            <h4 class="timeline-title">${escapeHtml(item.title)}</h4>
            <p class="timeline-sub">${escapeHtml(formatDateLabel(item.releaseDate))}（${escapeHtml(cd.text)}） ・ ¥${(
              item.price || 0
            ).toLocaleString()}</p>
            <span class="oshi-badge" style="margin-top:4px;display:inline-block;">${escapeHtml(
              SHELF_STATUS_META[status].label
            )}</span>
          </div>
          <span class="detail-trigger-btn">開く</span>
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
      '<div class="empty-state" style="grid-column:1/-1;"><p>雑誌名やタレント名を入力すると、5ストアの検索リンクが一括生成されます。</p></div>';
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
  if (!state.selectedItemId) {
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
  document.getElementById('lightboxCaption').textContent = photo.caption;
  const kindMeta = PHOTO_KIND_META[photo.kind] || { icon: '📷', label: '関連写真' };
  document.getElementById('lightboxSource').textContent = `${kindMeta.icon} ${kindMeta.label} ・ 出典：${photo.source}`;

  const link = document.getElementById('lightboxArticleLink');
  link.href = photo.articleUrl || '#';
  link.style.display = photo.articleUrl && photo.articleUrl !== '#' ? 'inline-flex' : 'none';

  const openItemBtn = document.getElementById('lightboxOpenItemBtn');
  openItemBtn.dataset.jumpItemId = photo.itemId || '';
  openItemBtn.style.display = photo.itemId && state.selectedItemId !== photo.itemId ? 'inline-block' : 'none';

  document.getElementById('lightboxPrevBtn').style.display = photos.length > 1 ? 'block' : 'none';
  document.getElementById('lightboxNextBtn').style.display = photos.length > 1 ? 'block' : 'none';
}

function openDetailSheet(itemId) {
  const item = getAllItems().find((entry) => entry.id === itemId);
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
  document.body.style.overflow = '';
}

function renderDetailSheetBody(item) {
  document.getElementById('sheetTitle').textContent = item.series || '関連写真＆特典比較';

  const cd = formatCountdown(item.releaseDate);
  const currentStatus = state.shelfMap[item.id] || '';
  const allPhotos = getItemPhotos(item);
  const filteredPhotos = allPhotos.filter(
    (p) => state.selectedPhotoKind === 'all' || p.kind === state.selectedPhotoKind
  );
  const photoKinds = [...new Set(allPhotos.map((p) => p.kind))];

  const visibleOffers = getVisibleOffers(item);
  const availableStores = STORE_ORDER.filter((sid) =>
    visibleOffers.some((o) => o.store === sid)
  );
  const offers = visibleOffers.filter(
    (o) => state.selectedOfferStore === 'all' || o.store === state.selectedOfferStore
  );

  const officialSns = getOfficialSnsForItem(item);
  const talentPromos = buildTalentPromoLinks(item);
  const pressArticles = item.pressArticles || [];

  const body = document.getElementById('sheetBody');
  body.innerHTML = `
    <div class="sheet-hero">
      ${renderCoverImg(item, 'sheet-cover')}
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
      </div>
    </div>

    ${
      (item.includedBonuses || []).length
        ? `<div class="included-strip" style="margin-bottom:10px;">
            ${item.includedBonuses.map((b) => `<div>${escapeHtml(b.label)}</div>`).join('')}
          </div>`
        : ''
    }

    ${
      item.printOnlyNote
        ? `<div style="font-size:11px;color:var(--ink-secondary);background:var(--bg);padding:8px 10px;border-radius:10px;margin-bottom:10px;">
            ℹ️ ${escapeHtml(item.printOnlyNote)}
          </div>`
        : ''
    }

    <div class="status-selector" aria-label="マイステータス">
      ${Object.entries(SHELF_STATUS_META)
        .map(
          ([key, meta]) => `
        <button
          class="status-btn ${currentStatus === key ? 'active' : ''}"
          type="button"
          data-set-status="${key}"
        >${escapeHtml(meta.label)}</button>
      `
        )
        .join('')}
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
        ※ Amazon（基本購入先）と限定特典ありストアのみ表示。絵柄タップで拡大比較できます。
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
        const amazonOffer = visibleOffers.find((o) => o.store === 'amazon');
        const amazonBasePrice = amazonOffer?.price || item.price || 0;
        const offerPhotos = offers.map((offer) => {
          const st = STORES[offer.store] || { name: offer.store, shortName: offer.store };
          const kind = (offer.bonusTypes || []).includes('cover')
            ? 'limited_cover'
            : offer.hasStoreExclusiveBonus
              ? 'bonus'
              : 'cover';
          return {
            itemId: item.id,
            itemTitle: item.title,
            url: offer.imageUrl || (offer.store === 'amazon' ? item.coverImageUrl || '' : ''),
            caption: `${st.name}｜${offer.edition}：${offer.bonusText}`,
            source: st.name,
            kind,
            articleUrl: offer.url,
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

              const stockLabel =
                offer.status === 'preorder'
                  ? '予約受付中'
                  : offer.status === 'low_stock'
                    ? '残りわずか'
                    : offer.status === 'on_sale'
                      ? '発売中'
                      : offer.status || '販売中';

              return `
                <article class="compare-card ${offer.hasStoreExclusiveBonus ? 'is-bonus' : ''}">
                  <button class="compare-img-btn" type="button" data-offer-photo-idx="${idx}" aria-label="${escapeHtml(offer.edition)}を拡大">
                    ${renderPhotoImg(offerPhotos[idx])}
                    <span class="compare-store-float ${store.badgeClass}">${escapeHtml(store.shortName)}</span>
                    <span class="compare-zoom-hint">${offer.imageUrl ? '🔍 拡大' : escapeHtml(stockLabel)}</span>
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

  document.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-quick-fav]');
    if (favBtn) {
      e.stopPropagation();
      const id = favBtn.dataset.quickFav;
      if (state.shelfMap[id]) delete state.shelfMap[id];
      else state.shelfMap[id] = 'want';
      saveJson(STORAGE_KEYS.shelf, state.shelfMap);
      renderMagazineGrid();
      renderOshiAndShelf();
      return;
    }

    const itemLightboxBtn = e.target.closest('[data-item-lightbox]');
    if (itemLightboxBtn) {
      e.stopPropagation();
      const item = getAllItems().find((entry) => entry.id === itemLightboxBtn.dataset.itemLightbox);
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

  // Sheet interactions
  const sheetBackdrop = document.getElementById('detailSheet');
  document.getElementById('sheetCloseBtn').addEventListener('click', closeDetailSheet);
  sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetBackdrop) closeDetailSheet();
  });

  document.getElementById('sheetBody').addEventListener('click', (e) => {
    const item = getAllItems().find((entry) => entry.id === state.selectedItemId);
    if (!item) return;

    const statusBtn = e.target.closest('[data-set-status]');
    if (statusBtn) {
      const next = statusBtn.dataset.setStatus;
      if (state.shelfMap[item.id] === next) delete state.shelfMap[item.id];
      else state.shelfMap[item.id] = next;
      saveJson(STORAGE_KEYS.shelf, state.shelfMap);
      renderDetailSheetBody(item);
      renderMagazineGrid();
      renderOshiAndShelf();
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

  // Lightbox controls
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  document.getElementById('photoLightbox').addEventListener('click', (e) => {
    if (e.target.id === 'photoLightbox') closeLightbox();
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
