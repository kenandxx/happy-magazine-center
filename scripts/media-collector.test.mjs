import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractImagesFromHtml,
  extractStoreAndSnsLinks,
  parseRssItems,
} from './media-collector.mjs';

test('extractImagesFromHtml extracts high-res preview & bonus photos while filtering logos/icons', () => {
  const sampleHtml = `
    <html>
      <head>
        <meta property="og:image" content="https://prcdn.freetls.fastly.net/release_image/6568/3579/main.jpg?width=1200" />
      </head>
      <body>
        <img src="https://example.com/assets/site-logo.png" alt="Logo" />
        <img src="https://prcdn.freetls.fastly.net/release_image/6568/3579/cut1.jpg" alt="瀬戸口心月 先行カット" />
        <img data-src="https://7net.omni7.jp/dw/image/v2/BLHS_PRD/1107786573.jpg?sw=1150" alt="セブンネット限定特典 ポストカード" />
        <img src="https://zasshi.tv/wp/wp-content/uploads/2020/03/now_printing.jpg" alt="準備中" />
      </body>
    </html>
  `;

  const images = extractImagesFromHtml(sampleHtml, 'https://prtimes.jp/');
  assert.equal(images.length, 3);
  assert.equal(images[0].kind, 'cover');
  assert.equal(images[1].kind, 'preview');
  assert.equal(images[2].kind, 'bonus');
});

test('extractStoreAndSnsLinks parses 7net, HMV, Amazon, Instagram, and X URLs from press release text', () => {
  const sampleHtml = `
    <p>セブンネット特典① https://7net.omni7.jp/detail/1107786570.html</p>
    <p>HMV特典 https://www.hmv.co.jp/product/detail/17392872</p>
    <p>Amazon https://www.amazon.co.jp/dp/4087902609</p>
    <p>公式Instagram https://www.instagram.com/b.l.t.official/</p>
    <p>公式X https://x.com/BLTTV</p>
  `;

  const { storeLinks, snsLinks } = extractStoreAndSnsLinks(sampleHtml);
  assert.equal(storeLinks.length, 3);
  assert.deepEqual(
    storeLinks.map((s) => s.store),
    ['7net', 'hmv', 'amazon']
  );
  assert.equal(snsLinks.length, 2);
  assert.deepEqual(
    snsLinks.map((s) => s.platform),
    ['instagram', 'x']
  );
});

test('parseRssItems extracts press release titles and links from RSS XML', () => {
  const xml = `
    <rss><channel>
      <item>
        <title><![CDATA[乃木坂46・瀬戸口心月が「B.L.T.1月号」表紙に登場！]]></title>
        <link>https://prtimes.jp/main/html/rd/p/000003579.000006568.html</link>
        <pubDate>Fri, 13 Nov 2026 19:37:00 +0900</pubDate>
      </item>
    </channel></rss>
  `;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.ok(items[0].title.includes('B.L.T.1月号'));
});
