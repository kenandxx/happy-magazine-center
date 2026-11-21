import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterOffersByPolicy,
  groupStoreOffers,
  normalizeIssueKey,
  parseBonusInfo,
} from './normalizer.mjs';

test('normalizeIssueKey groups 7net, Rakuten, HMV, and TSUTAYA editions of the same magazine issue', () => {
  const titles = [
    'アップトゥボーイ 2027年1月号【セブンネット限定特典：川﨑桜（乃木坂46）ポストカードA 1枚付き】',
    'アップトゥボーイ 2027年1月号「セブンネット限定表紙：金澤亜美（僕が見たかった青空）ver.」【セブンネット限定特典：金澤亜美 ポストカード 1枚付き】',
    '【楽天ブックス限定特典】UTB (アップ トゥ ボーイ) 2027年 1月号 [雑誌](生写真1枚)',
    'アップトゥボーイ 2027年1月号増刊 TSUTAYA限定表紙版',
  ];

  const keys = titles.map((t) => normalizeIssueKey(t));
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], 'アップトゥボーイ::2027-01');
});

test('parseBonusInfo detects multiple bonus types including posters, postcards, limited covers, and signed books', () => {
  const multi = parseBonusInfo(
    'アップトゥボーイ 2027年1月号「セブンネット限定表紙：金澤亜美ver.」【セブンネット限定特典：ポストカード1枚付き】',
    '付録は特大両面ポスター付き'
  );
  assert.equal(multi.hasSpecialBonus, true);
  assert.ok(multi.bonusTypes.includes('cover'));
  assert.ok(multi.bonusTypes.includes('postcard'));
  assert.ok(multi.bonusTypes.includes('poster'));

  const signed = parseBonusInfo('田中有紀写真集 ゆきのとなり。【セブンネット限定：直筆サイン本】');
  assert.ok(signed.bonusTypes.includes('signed'));
});

test('groupStoreOffers consolidates multi-store listings into grouped comparison cards', () => {
  const grouped = groupStoreOffers([
    {
      store: '7net',
      title: 'B.L.T. 2027年1月号【セブンネット限定特典：瀬戸口心月 ポストカードA 1枚付き】',
      releaseDate: '2026-11-28',
      price: 1430,
      url: 'https://7net.omni7.jp/example-1',
    },
    {
      store: 'hmv',
      title: '《HMV限定特典：瀬戸口心月ポストカード》B.L.T. 2027年 1月号',
      releaseDate: '2026-11-28',
      price: 1430,
      url: 'https://www.hmv.co.jp/example-1',
    },
    {
      store: 'rakuten',
      title: 'B.L.T.関東版 2027年 1月号 [雑誌]',
      releaseDate: '2026-11-28',
      price: 1430,
      url: 'https://books.rakuten.co.jp/example-1',
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].offers.length, 3);
  assert.deepEqual(
    grouped[0].offers.map((o) => o.store),
    ['7net', 'hmv', 'rakuten']
  );
});

test('normalizeIssueKey strips Rakuten trailing bonus parentheses to match standard mook editions', () => {
  const rakutenKey = normalizeIssueKey(
    '【楽天ブックス限定特典】グラビアザテレビジョン vol.82(山田あい大判ブロマイド)'
  );
  const amazonKey = normalizeIssueKey('グラビアザテレビジョン vol.82');
  assert.equal(rakutenKey, amazonKey);
});

test('filterOffersByPolicy keeps Amazon always and drops non-Amazon offers without store-exclusive bonus', () => {
  const grouped = groupStoreOffers([
    {
      store: '7net',
      title: 'B.L.T. 2027年1月号【セブンネット限定特典：瀬戸口心月 ポストカードA 1枚付き】',
      url: 'https://7net.omni7.jp/detail/1107786570.html',
    },
    {
      store: 'rakuten',
      title: 'B.L.T.関東版 2027年 1月号 [雑誌]',
      url: 'https://books.rakuten.co.jp/rb/example',
    },
    {
      store: 'hmv',
      title: 'B.L.T. 2027年 1月号【表紙：瀬戸口心月】',
      url: 'https://www.hmv.co.jp/example',
    },
    {
      store: 'amazon',
      title: 'B.L.T. 2027年1月号',
      url: 'https://www.amazon.co.jp/example',
    },
  ]);

  const filtered = filterOffersByPolicy(grouped[0].offers);
  assert.deepEqual(
    filtered.map((o) => o.store),
    ['7net', 'amazon']
  );
});

test('validateCatalogStructure rejects Amazon reusing a 7net bonus postcard and dynamic/403 URLs', async () => {
  const { validateCatalogStructure, isSuspiciousImageUrl } = await import('./validate-catalog.mjs');

  assert.ok(isSuspiciousImageUrl('https://img.fujisan.co.jp/images/products/74_l.jpg'));
  assert.ok(isSuspiciousImageUrl('https://store.tsite.jp/example.jpg'));
  assert.equal(isSuspiciousImageUrl('https://img.hmv.co.jp/image/jacket/800/0000174/0/4/251.jpg'), null);

  const badCatalog = {
    items: [
      {
        id: 'utb-test',
        releaseDate: '2026-11-24',
        coverImageUrl: 'https://7net.omni7.jp/1107785764.jpg',
        offers: [
          {
            id: 'offer-7net',
            store: '7net',
            hasStoreExclusiveBonus: true,
            bonusTypes: ['postcard'],
            imageUrl: 'https://7net.omni7.jp/1107785764.jpg',
          },
          {
            id: 'offer-amazon',
            store: 'amazon',
            hasStoreExclusiveBonus: false,
            bonusTypes: ['standard'],
            imageUrl: 'https://7net.omni7.jp/1107785764.jpg',
          },
        ],
      },
    ],
  };

  const report = validateCatalogStructure(badCatalog);
  assert.ok(report.errors.length >= 2);
});

test('live data/catalog.json passes full structural, policy, and unique offer.id validation', async () => {
  const fs = await import('node:fs');
  const { validateCatalogStructure } = await import('./validate-catalog.mjs');
  const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const report = validateCatalogStructure(catalog);
  assert.equal(report.nonAmazonNonBonus, 0);
  assert.deepEqual(report.errors, []);
  assert.ok(report.totalItems >= 125, `Expected >=125 items, got ${report.totalItems}`);
  const r18Count = catalog.items.filter((i) => i.category === 'r18').length;
  assert.ok(r18Count >= 35, `Expected >=35 R18 items, got ${r18Count}`);
  const autoCount = catalog.items.filter((i) => i.autoDiscovered === true).length;
  assert.ok(autoCount >= 20, `Expected >=20 autoDiscovered items, got ${autoCount}`);
  assert.ok(
    catalog.items.some((i) => i.id === 'pb-matsui-jurina-aiwoshiru'),
    'Expected Matsui Jurina photobook in catalog'
  );
});

test('calculateScarcityScore ranks 3000-copy limited, signed, and exclusive-cover releases strictly above standard titles', async () => {
  const { calculateScarcityScore, getUrgentRadarItems } = await import('../src/scarcity-score.js');

  const limitedTopStar = {
    id: 'test-limited',
    title: '小野六花 写真集『RIKKA!!』（豪華愛蔵版3000部限定）',
    category: 'r18',
    releaseDate: '2026-12-25',
    coverTalents: ['小野六花'],
    offers: [
      {
        id: 'o-1',
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: 'Amazon 通常版',
        bonusTypes: ['standard'],
        bonusText: '豪華愛蔵版3000部限定',
        status: 'preorder',
        url: 'https://www.amazon.co.jp/',
      },
    ],
  };

  const plainStandard = {
    id: 'test-plain',
    title: '一般誌 2027年1月号',
    category: 'weekly',
    releaseDate: '2026-12-25',
    coverTalents: ['新星モデル'],
    offers: [
      {
        id: 'o-2',
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: 'Amazon 通常版',
        bonusTypes: ['standard'],
        bonusText: '通常版',
        status: 'preorder',
        url: 'https://www.amazon.co.jp/',
      },
    ],
  };

  const oldPastItem = {
    ...limitedTopStar,
    id: 'test-old',
    releaseDate: '2026-09-01',
  };

  const forecastItem = {
    id: 'test-2027-03-forecast',
    title: '乃木坂46 表紙予定誌【解禁ウォッチ】',
    category: 'idol',
    releaseDate: '2027-01-22',
    coverTalents: ['乃木坂46'],
    offers: [
      {
        id: 'o-f',
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: '予約解禁ウォッチ',
        bonusTypes: ['standard'],
        status: 'forecast',
        url: 'https://www.amazon.co.jp/',
      },
    ],
  };

  const sLimited = calculateScarcityScore(limitedTopStar, { referenceDate: '2026-11-21' });
  const sPlain = calculateScarcityScore(plainStandard, { referenceDate: '2026-11-21' });
  const sOld = calculateScarcityScore(oldPastItem, { referenceDate: '2026-11-21' });
  const sForecast = calculateScarcityScore(forecastItem, {
    referenceDate: '2026-11-21',
    oshiKeywords: ['乃木坂46'],
  });

  assert.equal(sLimited.rank, 'S');
  assert.ok(sLimited.score >= 68);
  assert.ok(sLimited.score > sPlain.score);
  assert.equal(sOld.inWindow, false);
  assert.equal(sForecast.rank, 'B');
  assert.ok(sForecast.score <= 44);

  const radar = getUrgentRadarItems([plainStandard, oldPastItem, limitedTopStar, forecastItem], {
    referenceDate: '2026-11-21',
    oshiKeywords: ['乃木坂46'],
  });
  assert.equal(radar[0].item.id, 'test-limited');
  assert.ok(!radar.some((r) => r.item.id === 'test-old'));
});

test('custom VIP S-Rank tier (+30pt) and configurable 3-step Oshi Boost (+14/+24/+34) boost matching items accurately', async () => {
  const { calculateScarcityScore, OSHI_BOOST_PRESETS, POPULAR_TALENT_PRESETS } = await import(
    '../src/scarcity-score.js'
  );

  const sampleItem = {
    id: 'test-vip-actress',
    title: '新人スター ファースト写真集',
    category: 'r18',
    releaseDate: '2026-11-28',
    coverTalents: ['サンプル女優A'],
    offers: [
      {
        id: 'o-vip',
        store: 'amazon',
        hasStoreExclusiveBonus: false,
        edition: 'Amazon 通常版',
        bonusTypes: ['standard'],
        status: 'preorder',
        url: 'https://www.amazon.co.jp/',
      },
    ],
  };

  const base = calculateScarcityScore(sampleItem, { referenceDate: '2026-11-21' });
  const oshiStd = calculateScarcityScore(sampleItem, {
    referenceDate: '2026-11-21',
    oshiKeywords: ['サンプル女優A'],
    oshiBoostMode: 'standard',
  });
  const oshiStrong = calculateScarcityScore(sampleItem, {
    referenceDate: '2026-11-21',
    oshiKeywords: ['サンプル女優A'],
    oshiBoostMode: 'strong',
  });
  const oshiMax = calculateScarcityScore(sampleItem, {
    referenceDate: '2026-11-21',
    oshiKeywords: ['サンプル女優A'],
    oshiBoostMode: 'max',
  });
  const vipAndOshi = calculateScarcityScore(sampleItem, {
    referenceDate: '2026-11-21',
    oshiKeywords: ['サンプル女優A'],
    vipTalents: ['サンプル女優A'],
    oshiBoostMode: 'strong',
  });

  assert.equal(oshiStd.score - base.score, OSHI_BOOST_PRESETS.standard.points);
  assert.equal(oshiStrong.score - base.score, OSHI_BOOST_PRESETS.strong.points);
  assert.equal(oshiMax.score - base.score, OSHI_BOOST_PRESETS.max.points);
  assert.equal(vipAndOshi.hasVipHit, true);
  assert.equal(vipAndOshi.rank, 'S');
  assert.ok(vipAndOshi.score >= 72);

  // Verify 1-tap talent presets have unique names across all 4 groups
  const names = POPULAR_TALENT_PRESETS.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  for (const grp of ['idol', 'gravure', 'r18', 'bonus']) {
    assert.ok(POPULAR_TALENT_PRESETS.some((p) => p.group === grp), `Missing preset group ${grp}`);
  }
});

test('isbn-lookup extracts ISBN-13 from Amazon /dp/ URLs, ISBN-10, and hyphenated ISBN-13 and parses openBD records', async () => {
  const { isbn10To13, extractIsbnFromInput, parseOpenBdRecord } = await import(
    '../src/isbn-lookup.js'
  );

  assert.equal(isbn10To13('4299065926'), '9784299065926');
  assert.deepEqual(extractIsbnFromInput('https://www.amazon.co.jp/dp/4299065926/ref=sr_1_1'), {
    isbn13: '9784299065926',
    isbn10: '4299065926',
    sourceType: 'amazon_url',
  });
  assert.deepEqual(extractIsbnFromInput('978-4-334-11192-2'), {
    isbn13: '9784334111922',
    isbn10: '',
    sourceType: 'isbn13',
  });
  assert.deepEqual(extractIsbnFromInput('4299065926'), {
    isbn13: '9784299065926',
    isbn10: '4299065926',
    sourceType: 'isbn10',
  });
  assert.equal(extractIsbnFromInput('松井珠理奈写真集'), null);

  const parsedPb = parseOpenBdRecord(
    {
      summary: {
        isbn: '9784299065926',
        title: '松井珠理奈写真集 アイヲシル',
        publisher: '宝島社',
        author: '松井珠理奈／著',
        pubdate: '20250909',
        cover: '',
      },
      onix: {
        ProductSupply: {
          SupplyDetail: { Price: [{ PriceAmount: '3500' }] },
        },
        CollateralDetail: {
          TextContent: [{ Text: '10年ぶり待望の2nd写真集！' }],
        },
      },
    },
    '9784299065926'
  );

  assert.equal(parsedPb.isbn, '9784299065926');
  assert.equal(parsedPb.talent, '松井珠理奈');
  assert.equal(parsedPb.releaseDate, '2025-09-09');
  assert.equal(parsedPb.price, 3850);
  assert.equal(parsedPb.category, 'photobook');
  assert.equal(parsedPb.coverImageUrl, 'https://img.hanmoto.com/bd/img/9784299065926.jpg');

  const parsedR18 = parseOpenBdRecord({
    summary: {
      isbn: '9784775606896',
      title: 'サンプル 豪華愛蔵版ヘアヌード写真集',
      publisher: '彩文館出版',
      pubdate: '20261225',
    },
  });
  assert.equal(parsedR18.category, 'r18');

  const parsedCal = parseOpenBdRecord({
    summary: {
      isbn: '9784000000000',
      title: '芳根京子 2027年カレンダー',
      publisher: 'ワニブックス',
      pubdate: '20261207',
    },
  });
  assert.equal(parsedCal.category, 'calendar');
});

test('prtimes-ingestor covers 15 publishers, filters noise accurately, and extracts release dates, prices, and exclusive bonuses', async () => {
  const { PRTIMES_PUBLISHER_FEEDS, isTargetReleaseTitle, parsePrTimesArticleHtml } = await import(
    './prtimes-ingestor.mjs'
  );

  assert.equal(PRTIMES_PUBLISHER_FEEDS.length, 15);
  assert.equal(isTargetReleaseTitle('兒玉遥 3rd写真集『You will see』11月26日発売決定！'), true);
  assert.equal(isTargetReleaseTitle('桃月なしこ『週刊少年チャンピオン』表紙＆巻頭グラビア'), true);
  assert.equal(isTargetReleaseTitle('デジタル写真集『〇〇』電子書籍限定で配信開始'), false);
  assert.equal(isTargetReleaseTitle('人気俳優〇〇 1st写真集発売＆お渡し会'), false);

  const sampleHtml = `
    <html><head>
      <meta property="og:image" content="https://prcdn.freetls.fastly.net/release_image/21468/2000/21468-2000-1.jpg?width=1950" />
    </head><body>
      <p>発売日：2026年11月26日（木）</p>
      <p>定価：3,850円（税込） ISBN 978-4-334-11192-2</p>
      <p>セブンネットショッピングでは限定表紙版＆生写真1枚付きで予約受付中（https://7net.omni7.jp/detail/1107799999）。</p>
      <p>楽天ブックス限定特典として限定ブロマイド1枚をプレゼント（https://books.rakuten.co.jp/rb/18400000/）。</p>
    </body></html>
  `;

  const parsed = parsePrTimesArticleHtml(sampleHtml, {
    title: '兒玉遥 3rd写真集『You will see』発売決定！',
    publisher: '光文社',
    url: 'https://prtimes.jp/main/html/rd/p/000002000.000021468.html',
    pubDate: '2026-11-10',
  });

  assert.equal(parsed.title, 'You will see');
  assert.equal(parsed.releaseDate, '2026-11-26');
  assert.equal(parsed.price, 3850);
  assert.equal(parsed.isbn, '9784334111922');
  assert.equal(parsed.category, 'photobook');
  assert.equal(
    parsed.coverImageUrl,
    'https://prcdn.freetls.fastly.net/release_image/21468/2000/21468-2000-1.jpg'
  );
  assert.deepEqual(
    parsed.storeBonuses.map((b) => b.store),
    ['7net', 'rakuten']
  );
  assert.ok(parsed.storeBonuses[0].bonusTypes.includes('cover'));
  assert.ok(parsed.storeBonuses[0].bonusTypes.includes('photo'));
});



