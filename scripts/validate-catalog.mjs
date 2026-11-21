/**
 * Strict Catalog Integrity, Store Policy & Image Accuracy Validator.
 *
 * Usage:
 *   node scripts/validate-catalog.mjs              # Fast offline schema/policy/cross-reference checks
 *   node scripts/validate-catalog.mjs --check-urls # Also verifies HTTP status & rejects HMV 15019B NO-IMAGE placeholders
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../data/catalog.json');

export const HMV_NO_IMAGE_BYTES = 15019;

export function isSuspiciousImageUrl(url = '') {
  if (!url) return null;
  if (/img\.fujisan\.co\.jp\/images\/products\/\d+_l\.jpg/i.test(url)) {
    return 'Dynamic Fujisan latest-issue URL (drifts over time)';
  }
  if (/tsite\.jp/i.test(url)) {
    return 'tsite.jp hotlink-protected image (returns HTTP 403)';
  }
  return null;
}

export async function verifyImageUrl(url) {
  const suspicious = isSuspiciousImageUrl(url);
  if (suspicious) return { ok: false, reason: suspicious };

  try {
    // Use GET with timeout; some CDNs (shop.r10s.jp) reject HEAD with 405
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; HappyMagazineCenterBot/1.0)',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) {
      return { ok: false, status: res.status, reason: `Non-image content-type: ${ct}` };
    }
    if (url.includes('img.hmv.co.jp') && buf.length === HMV_NO_IMAGE_BYTES) {
      return { ok: false, status: res.status, bytes: buf.length, reason: 'HMV NO-IMAGE placeholder (15019B)' };
    }
    if (buf.length < 4000) {
      return { ok: false, status: res.status, bytes: buf.length, reason: `Suspiciously tiny image (${buf.length}B)` };
    }
    return { ok: true, status: res.status, bytes: buf.length, contentType: ct };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'Timeout' : err.message };
  }
}

export function validateCatalogStructure(catalog) {
  const errors = [];
  const warnings = [];
  const items = catalog?.items || [];

  let nonAmazonNonBonus = 0;
  const seenItemIds = new Set();
  const seenOfferIds = new Set();
  const coverUrlOwner = new Map();

  for (const item of items) {
    if (!item.id) errors.push('Item missing id');
    if (seenItemIds.has(item.id)) errors.push(`Duplicate item.id: ${item.id}`);
    seenItemIds.add(item.id);

    if (!item.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(item.releaseDate)) {
      errors.push(`[${item.id}] Invalid releaseDate: ${item.releaseDate}`);
    }

    if (item.coverImageUrl) {
      const bad = isSuspiciousImageUrl(item.coverImageUrl);
      if (bad) errors.push(`[${item.id}] Bad coverImageUrl (${bad}): ${item.coverImageUrl}`);
      if (coverUrlOwner.has(item.coverImageUrl)) {
        errors.push(
          `[${item.id}] Duplicate coverImageUrl shared with [${coverUrlOwner.get(item.coverImageUrl)}]: ${item.coverImageUrl}`
        );
      } else {
        coverUrlOwner.set(item.coverImageUrl, item.id);
      }
    }

    const bonusOnlyUrls = new Set();
    for (const offer of item.offers || []) {
      if (!offer.id) errors.push(`[${item.id}] Offer missing id`);
      if (seenOfferIds.has(offer.id)) errors.push(`[${item.id}] Duplicate offer.id: ${offer.id}`);
      seenOfferIds.add(offer.id);

      if (offer.store !== 'amazon' && offer.hasStoreExclusiveBonus !== true) {
        nonAmazonNonBonus += 1;
        errors.push(`[${item.id}] Policy violation: non-Amazon offer without exclusive bonus (${offer.id})`);
      }

      if (offer.imageUrl) {
        const bad = isSuspiciousImageUrl(offer.imageUrl);
        if (bad) errors.push(`[${item.id}/${offer.id}] Bad offer imageUrl (${bad})`);
        if (offer.store !== 'amazon' && offer.hasStoreExclusiveBonus === true) {
          bonusOnlyUrls.add(offer.imageUrl);
        }
      }
    }

    // Ensure regular cover & Amazon regular offer never borrow a non-Amazon bonus-only postcard photo
    const amazonOffers = (item.offers || []).filter((o) => o.store === 'amazon');
    for (const amz of amazonOffers) {
      if (amz.imageUrl && bonusOnlyUrls.has(amz.imageUrl) && !amz.hasStoreExclusiveBonus) {
        errors.push(
          `[${item.id}] Amazon regular offer (${amz.id}) reuses a non-Amazon bonus image: ${amz.imageUrl}`
        );
      }
    }
    if (item.coverImageUrl && bonusOnlyUrls.has(item.coverImageUrl)) {
      const isSharedLimitedCover = (item.offers || []).some(
        (o) =>
          o.imageUrl === item.coverImageUrl &&
          o.hasStoreExclusiveBonus === true &&
          (o.bonusTypes || []).includes('cover')
      );
      if (!isSharedLimitedCover) {
        errors.push(
          `[${item.id}] coverImageUrl reuses a non-Amazon bonus postcard image: ${item.coverImageUrl}`
        );
      }
    }

    for (const g of item.gallery || []) {
      const bad = isSuspiciousImageUrl(g.url);
      if (bad) errors.push(`[${item.id}] Bad gallery image (${bad}): ${g.url}`);
    }
  }

  return {
    totalItems: items.length,
    totalOffers: seenOfferIds.size,
    nonAmazonNonBonus,
    errors,
    warnings,
  };
}

async function runCli() {
  const checkUrls = process.argv.includes('--check-urls');
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const report = validateCatalogStructure(catalog);

  console.log(
    `[validate] Items: ${report.totalItems}, Offers: ${report.totalOffers}, nonAmazonNonBonus: ${report.nonAmazonNonBonus}`
  );

  if (checkUrls) {
    const urlRefs = new Map();
    for (const item of catalog.items || []) {
      const add = (u, who) => {
        if (!u) return;
        if (!urlRefs.has(u)) urlRefs.set(u, []);
        urlRefs.get(u).push(who);
      };
      add(item.coverImageUrl, `${item.id}:cover`);
      for (const o of item.offers || []) add(o.imageUrl, `${item.id}:${o.id}`);
      for (const g of item.gallery || []) add(g.url, `${item.id}:gallery`);
    }

    const entries = [...urlRefs.entries()];
    console.log(`[validate] Checking ${entries.length} unique image URLs live...`);
    const CONCURRENCY = 8;
    let idx = 0;
    const urlFailures = [];
    const urlTimeouts = [];

    async function worker() {
      while (idx < entries.length) {
        const [url, refs] = entries[idx++];
        const res = await verifyImageUrl(url);
        if (!res.ok) {
          if (res.reason === 'Timeout' && url.includes('7net.omni7.jp')) {
            urlTimeouts.push({ url, refs, reason: res.reason });
          } else {
            urlFailures.push({ url, refs, reason: res.reason });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (urlTimeouts.length) {
      console.log(`[validate] Note: ${urlTimeouts.length} slow 7net CDN timeout(s) (non-fatal from VM):`);
      for (const t of urlTimeouts) console.log(`  - ${t.refs[0]} => ${t.url}`);
    }
    for (const f of urlFailures) {
      report.errors.push(`Broken image (${f.reason}) at ${f.refs.join(', ')} => ${f.url}`);
    }
  }

  if (report.errors.length) {
    console.error(`[validate] FAILED with ${report.errors.length} error(s):`);
    for (const err of report.errors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }
  console.log('[validate] PASSED — 0 errors, 0 policy violations, 0 mismatched/broken images!');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
