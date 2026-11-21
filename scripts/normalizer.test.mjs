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
  assert.ok(report.totalItems >= 75);
});
