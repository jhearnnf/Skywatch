'use strict';

const TIMEOUT_MS = 10_000;
const READ_LIMIT  = 100_000; // 100 KB — enough to cover <head> on any page

/**
 * Converts a raw date string (ISO, YYYY-MM-DD, human-readable) to YYYY-MM-DD.
 * Returns null if the string is unparseable or produces an invalid date.
 */
function toYMD(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Returns the value of a <meta> tag's content attribute, matching by attr=value
 * regardless of attribute order in the tag.
 * attr should be 'property' or 'name'; value is the target attribute value.
 */
function metaContent(html, attr, value) {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${v}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${v}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Fetches a URL and streams the first READ_LIMIT bytes as a string.
 * Returns null on network error, timeout, or non-2xx response.
 */
async function fetchHead(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':      'Mozilla/5.0 (compatible; Skywatch/1.0)',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < READ_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return html;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Scrapes the real publication (or last-modified) date from a source URL.
 *
 * Wikipedia: returns article:modified_time (last edited), or null if absent.
 * All other sites: tries structured meta tags in priority order:
 *   1. JSON-LD datePublished
 *   2. <meta property="article:published_time"> (OpenGraph)
 *   3. <meta name="pubdate|publish-date|publishdate">
 *   4. <meta itemprop="datePublished"> (schema.org microdata)
 *   5. <meta name="DC.date.issued"> (Dublin Core)
 *   6. <meta name="date">
 *
 * Returns a YYYY-MM-DD string, or null if no reliable date can be found.
 */
async function scrapeArticleDate(url) {
  if (!url || typeof url !== 'string') return null;

  const html = await fetchHead(url);
  if (!html) return null;

  if (/wikipedia\.org/i.test(url)) {
    return null;
  }

  // 1. JSON-LD datePublished — most reliable, used by BBC, GOV.UK, Reuters, etc.
  const ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldBlocks) {
    for (const block of ldBlocks) {
      const inner = block.replace(/<\/?script[^>]*>/gi, '');
      const m = inner.match(/"datePublished"\s*:\s*"([^"]+)"/);
      if (m) { const d = toYMD(m[1]); if (d) return d; }
    }
  }

  // 2. OpenGraph article:published_time
  const ogPub = metaContent(html, 'property', 'article:published_time');
  if (ogPub) { const d = toYMD(ogPub); if (d) return d; }

  // 3. pubdate variants
  for (const name of ['pubdate', 'publish-date', 'publishdate']) {
    const v = metaContent(html, 'name', name);
    if (v) { const d = toYMD(v); if (d) return d; }
  }

  // 4. schema.org microdata
  const itemprop = metaContent(html, 'itemprop', 'datePublished');
  if (itemprop) { const d = toYMD(itemprop); if (d) return d; }

  // 5. Dublin Core
  for (const name of ['DC.date.issued', 'DC.Date']) {
    const v = metaContent(html, 'name', name);
    if (v) { const d = toYMD(v); if (d) return d; }
  }

  // 6. Generic date meta (last resort — broad, could match non-article dates)
  const dateMeta = metaContent(html, 'name', 'date');
  if (dateMeta) { const d = toYMD(dateMeta); if (d) return d; }

  return null;
}

/**
 * Enriches an array of source objects with scraped article dates.
 * Always replaces articleDate with the scraped value when one is found,
 * since scraped dates are more reliable than AI-generated ones.
 * Falls back to the existing value (or null) if scraping fails.
 * All fetches run in parallel.
 */
async function enrichSourceDates(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return sources;
  const results = await Promise.allSettled(sources.map(s => scrapeArticleDate(s.url)));
  return sources.map((s, i) => {
    const outcome = results[i];
    if (outcome.status === 'fulfilled' && outcome.value) {
      return { ...s, articleDate: outcome.value };
    }
    return s;
  });
}

module.exports = { scrapeArticleDate, enrichSourceDates };
