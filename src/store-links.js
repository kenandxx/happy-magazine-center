export const STORES = {
  '7net': {
    id: '7net',
    name: 'セブンネット',
    shortName: '7net',
    badgeClass: 'store-7net',
    pickupNote: 'セブン-イレブン店舗受取で送料無料',
    buildSearchUrl: (query, bonusOnly = true) => {
      const q = bonusOnly ? `${query} セブンネット限定特典` : query;
      return `https://7net.omni7.jp/search?q=${encodeURIComponent(q)}`;
    },
  },
  rakuten: {
    id: 'rakuten',
    name: '楽天ブックス',
    shortName: '楽天',
    badgeClass: 'store-rakuten',
    pickupNote: '全品送料無料・楽天ポイント対応',
    buildSearchUrl: (query, bonusOnly = true) => {
      const q = bonusOnly ? `${query} 楽天ブックス限定` : query;
      return `https://books.rakuten.co.jp/search?sitem=${encodeURIComponent(q)}&g=000`;
    },
  },
  hmv: {
    id: 'hmv',
    name: 'HMV&BOOKS',
    shortName: 'HMV',
    badgeClass: 'store-hmv',
    pickupNote: 'ローソン受取・Loppi/HMV限定特典',
    buildSearchUrl: (query, bonusOnly = true) => {
      const q = bonusOnly ? `${query} HMV限定` : query;
      return `https://www.hmv.co.jp/search/keyword_${encodeURIComponent(q)}/target_ALL/type_sr/`;
    },
  },
  amazon: {
    id: 'amazon',
    name: 'Amazon',
    shortName: 'Amazon',
    badgeClass: 'store-amazon',
    pickupNote: '通常版・Amazon限定表紙・Kindle比較',
    buildSearchUrl: (query, bonusOnly = false) => {
      const q = bonusOnly ? `${query} Amazon限定` : query;
      return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&i=stripbooks`;
    },
  },
  tsutaya: {
    id: 'tsutaya',
    name: 'TSUTAYA',
    shortName: 'TSUTAYA',
    badgeClass: 'store-tsutaya',
    pickupNote: '限定表紙版・SHIBUYA TSUTAYA特典',
    buildSearchUrl: (query, bonusOnly = true) => {
      const q = bonusOnly ? `${query} TSUTAYA限定` : query;
      return `https://shop.tsutaya.co.jp/search_result.html?searchKeyword=${encodeURIComponent(q)}`;
    },
  },
};

export const STORE_ORDER = ['7net', 'rakuten', 'hmv', 'tsutaya', 'amazon'];

export const BONUS_TYPE_META = {
  poster: { label: 'ポスター', icon: '🖼', pillClass: 'bonus-poster' },
  postcard: { label: 'ポストカード', icon: '📮', pillClass: 'bonus-postcard' },
  photo: { label: '生写真/ブロマイド', icon: '📸', pillClass: 'bonus-photo' },
  cover: { label: '限定表紙', icon: '✨', pillClass: 'bonus-cover' },
  dvd: { label: 'DVD/動画', icon: '📀', pillClass: 'bonus-dvd' },
  card: { label: 'フォトカード', icon: '🃏', pillClass: 'bonus-card' },
  signed: { label: '直筆サイン', icon: '✒️', pillClass: 'bonus-signed' },
  standard: { label: '通常版', icon: '📖', pillClass: 'bonus-standard' },
};

export const CATEGORY_META = {
  all: { label: 'すべて' },
  idol: { label: 'アイドル専門誌' },
  gravure: { label: 'グラビア・ムック' },
  weekly: { label: '週刊誌・コミック誌' },
  fashion: { label: '女性誌・アイドル表紙' },
  photobook: { label: '写真集' },
  calendar: { label: '🗓 カレンダー' },
  r18: { label: '🔞 アダルト・R18' },
};

export function buildAllStoreSearchLinks(keyword, bonusOnly = true) {
  const clean = (keyword || '').trim();
  if (!clean) return [];
  return STORE_ORDER.map((storeId) => {
    const store = STORES[storeId];
    return {
      ...store,
      url: store.buildSearchUrl(clean, storeId === 'amazon' ? false : bonusOnly),
      bonusUrl: store.buildSearchUrl(clean, true),
    };
  });
}
