function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(text = '', max = 16) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function createEditorialCoverDataUri(item) {
  const [c1, c2, c3] = item.palette || ['#E11D48', '#FB7185', '#FFF1F2'];
  const series = escapeXml(truncateText(item.series || item.title, 15));
  const issue = escapeXml(truncateText(item.issueLabel || '', 18));
  const talent = escapeXml(truncateText((item.coverTalents && item.coverTalents[0]) || item.publisher || '', 15));
  const releaseShort = item.releaseDate ? item.releaseDate.slice(5).replace('-', '/') : '';
  const photoCount = (item.gallery || []).length;
  const hasPoster =
    (item.includedBonuses || []).some((b) => b.type === 'poster') ||
    (item.offers || []).some((o) => (o.bonusTypes || []).includes('poster'));

  const badgeText =
    photoCount > 1
      ? `${photoCount} PHOTOS`
      : hasPoster
        ? 'BIG POSTER'
        : item.category === 'photobook'
          ? 'PHOTOBOOK'
          : 'NEW ISSUE';

  const categoryTag =
    item.category === 'photobook'
      ? 'PHOTO BOOK'
      : item.category === 'weekly'
        ? 'WEEKLY ISSUE'
        : item.category === 'gravure'
          ? 'GRAVURE MOOK'
          : 'IDOL MAGAZINE';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="55%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#09090B" stop-opacity="0.08" />
      <stop offset="52%" stop-color="#09090B" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#09090B" stop-opacity="0.72" />
    </linearGradient>
  </defs>
  <rect width="300" height="400" fill="url(#bg)" />
  <circle cx="235" cy="140" r="95" fill="#FFFFFF" fill-opacity="0.18" />
  <circle cx="72" cy="275" r="76" fill="#FFFFFF" fill-opacity="0.14" />
  <rect width="300" height="400" fill="url(#shade)" />
  <rect x="14" y="14" width="272" height="372" fill="none" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="1" rx="8" />

  <rect x="24" y="26" width="118" height="22" rx="11" fill="#09090B" fill-opacity="0.42" />
  <text x="83" y="41" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="10" font-weight="700" letter-spacing="1.2">${escapeXml(categoryTag)}</text>

  <rect x="216" y="26" width="60" height="22" rx="11" fill="#FFFFFF" fill-opacity="0.92" />
  <text x="246" y="41" text-anchor="middle" fill="#18181B" font-family="sans-serif" font-size="11" font-weight="800">${escapeXml(releaseShort)}</text>

  <text x="26" y="96" fill="#FFFFFF" font-family="sans-serif" font-size="26" font-weight="900" letter-spacing="-0.5">${series}</text>
  <text x="27" y="122" fill="#FFFFFF" fill-opacity="0.92" font-family="sans-serif" font-size="14" font-weight="600">${issue}</text>

  <line x1="26" y1="274" x2="274" y2="274" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1" />
  <text x="26" y="296" fill="#FFFFFF" fill-opacity="0.82" font-family="sans-serif" font-size="10" font-weight="700" letter-spacing="1.4">COVER / FEATURE</text>
  <text x="26" y="324" fill="#FFFFFF" font-family="sans-serif" font-size="18" font-weight="800">${talent}</text>

  <rect x="26" y="344" width="144" height="26" rx="6" fill="#FFFFFF" />
  <text x="98" y="361" text-anchor="middle" fill="${c1}" font-family="sans-serif" font-size="11" font-weight="900" letter-spacing="0.8">${escapeXml(badgeText)}</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function createGalleryPhotoFallbackDataUri(item, photo) {
  const [c1, c2] = item.palette || ['#E11D48', '#FB7185'];
  const kindLabelMap = {
    cover: 'COVER',
    back_cover: 'BACK COVER',
    limited_cover: 'LIMITED COVER',
    bonus: 'STORE BONUS',
    poster: 'POSTER',
    preview: 'PREVIEW CUT',
    sns: 'SNS OFF-SHOT',
  };
  const tag = escapeXml(kindLabelMap[photo.kind] || 'PHOTO');
  const caption = escapeXml(truncateText(photo.caption || item.title, 18));
  const source = escapeXml(truncateText(photo.source || item.series || '', 18));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
  <defs>
    <linearGradient id="pbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="100%" stop-color="${c2}" />
    </linearGradient>
  </defs>
  <rect width="300" height="400" fill="url(#pbg)" />
  <rect width="300" height="400" fill="#09090B" fill-opacity="0.28" />
  <rect x="16" y="16" width="268" height="368" rx="12" fill="none" stroke="#FFFFFF" stroke-opacity="0.38" />
  <rect x="28" y="30" width="126" height="24" rx="12" fill="#FFFFFF" fill-opacity="0.92" />
  <text x="91" y="46" text-anchor="middle" fill="${c1}" font-family="sans-serif" font-size="10.5" font-weight="900">${tag}</text>
  <circle cx="150" cy="172" r="46" fill="#FFFFFF" fill-opacity="0.16" />
  <text x="150" y="182" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="28">📷</text>
  <text x="28" y="308" fill="#FFFFFF" fill-opacity="0.82" font-family="sans-serif" font-size="11" font-weight="700">${source}</text>
  <text x="28" y="336" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="800">${caption}</text>
  <text x="28" y="362" fill="#FFFFFF" fill-opacity="0.78" font-family="sans-serif" font-size="10.5">タップして出典ページで高画質表示</text>
</svg>`.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
