/**
 * No-login public media extractor for press releases (PR TIMES), official magazine sites
 * (B.L.T.web, BUBKA WEB, MANGA Watch, etc.), and store pages.
 *
 * Extracts high-res preview images, store purchase links, and official SNS links without
 * requiring any user credentials or private API tokens.
 */

const EXCLUDED_IMAGE_PATTERNS = [
  /logo/i,
  /icon/i,
  /favicon/i,
  /sprite/i,
  /banner/i,
  /avatar/i,
  /now_printing/i,
  /noimage/i,
  /1x1/i,
  /pixel/i,
  /\.svg(?:\?|$)/i,
  /\.gif(?:\?|$)/i,
];

function decodeHtmlAttr(val = '') {
  return String(val)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveUrl(rawUrl, baseUrl) {
  try {
    return new URL(decodeHtmlAttr(rawUrl), baseUrl).href;
  } catch {
    return null;
  }
}

export function isLikelyContentPhoto(url = '') {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (EXCLUDED_IMAGE_PATTERNS.some((re) => re.test(url))) return false;
  return /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url) || /prcdn\.freetls\.fastly\.net|7net\.omni7\.jp\/dw\/image|img\.hmv\.co\.jp|r10s\.jp|contents\.oricon\.co\.jp/i.test(url);
}

export function extractImagesFromHtml(html = '', baseUrl = 'https://example.com') {
  const seen = new Set();
  const images = [];

  const pushImg = (rawUrl, caption = '', kind = 'preview') => {
    const resolved = resolveUrl(rawUrl, baseUrl);
    if (!resolved || seen.has(resolved) || !isLikelyContentPhoto(resolved)) return;
    seen.add(resolved);
    images.push({ url: resolved, caption: caption.trim(), kind });
  };

  // 1. OpenGraph & Twitter card images
  const metaRegex = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(metaRegex)) {
    pushImg(m[1], '記事メインビジュアル', 'cover');
  }
  const metaRegexRev = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi;
  for (const m of html.matchAll(metaRegexRev)) {
    pushImg(m[1], '記事メインビジュアル', 'cover');
  }

  // 2. Inline <img> tags (src & data-src)
  const imgTagRegex = /<img\b[^>]*>/gi;
  for (const m of html.matchAll(imgTagRegex)) {
    const tag = m[0];
    const srcMatch = tag.match(/(?:data-src|data-original|src)=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const altMatch = tag.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? decodeHtmlAttr(altMatch[1]) : '';
    const kind = /限定表紙/.test(alt)
      ? 'limited_cover'
      : /裏表紙/.test(alt)
        ? 'back_cover'
        : /特典|ポストカード|生写真/.test(alt)
          ? 'bonus'
          : /ポスター/.test(alt)
            ? 'poster'
            : /表紙/.test(alt)
              ? 'cover'
              : 'preview';
    pushImg(srcMatch[1], alt, kind);
  }

  return images;
}

export function extractStoreAndSnsLinks(html = '') {
  const urls = new Set();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>）)]+/g)) {
    urls.add(decodeHtmlAttr(m[0]).replace(/[.,;]+$/, ''));
  }

  const storeLinks = [];
  const snsLinks = [];

  for (const url of urls) {
    if (/7net\.omni7\.jp\/detail\/\d+\.html/i.test(url)) {
      storeLinks.push({ store: '7net', url });
    } else if (/books\.rakuten\.co\.jp\/rb\/\d+/i.test(url)) {
      storeLinks.push({ store: 'rakuten', url });
    } else if (/hmv\.co\.jp\/(?:product\/detail\/\d+|artist_[^/]+\/item_)/i.test(url)) {
      storeLinks.push({ store: 'hmv', url });
    } else if (/amazon\.co\.jp\/(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(url)) {
      storeLinks.push({ store: 'amazon', url });
    } else if (/tsutaya\.tsite\.jp|shop\.tsutaya\.co\.jp/i.test(url)) {
      storeLinks.push({ store: 'tsutaya', url });
    } else if (/instagram\.com\/[A-Za-z0-9._]+\/?$/i.test(url)) {
      snsLinks.push({ platform: 'instagram', url });
    } else if (/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/?$/i.test(url)) {
      snsLinks.push({ platform: 'x', url });
    } else if (/youtube\.com\/(?:channel\/|@)/i.test(url)) {
      snsLinks.push({ platform: 'youtube', url });
    }
  }

  return { storeLinks, snsLinks };
}

export function parseRssItems(xml = '') {
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() || '';
    if (title && link) {
      items.push({ title, link, pubDate });
    }
  }
  return items;
}
