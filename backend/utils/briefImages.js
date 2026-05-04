const crypto = require('crypto');
const Media = require('../models/Media');
const { uploadBuffer } = require('./cloudinary');
const { callOpenRouter } = require('./openRouter');

function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

const MAX_IMAGES = 2;
const ALL_SOURCES = ['dvids', 'commons', 'wikipedia'];

async function extractSearchTerms({ title, subtitle, imagePromptBase }) {
  const data = await callOpenRouter({
    key:     'main',
    feature: 'brief-image-search-terms',
    body: {
      model: 'openai/gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `${imagePromptBase}\n\nTitle: "${title}"${subtitle ? `\nSubtitle: "${subtitle}"` : ''}`,
      }],
    },
  });
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]';
  let terms = [];
  try { terms = JSON.parse(raw.replace(/```json\n?|```/g, '').trim()); } catch { terms = [title]; }
  if (!Array.isArray(terms) || !terms.length) terms = [title];
  return terms.slice(0, MAX_IMAGES);
}

// ── Source fetchers ─────────────────────────────────────────────────────────
// Each returns an array of { imageUrl, pageTitle } or [] on failure / no results.

async function fetchDvidsImages(term, max = 1) {
  const apiKey = process.env.DVIDS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.dvidshub.net/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(term)}&type=image&rows=${max}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SkyWatch/1.0 (educational-platform)' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? [])
      .filter(r => r.thumbnail)
      .map(r => ({ imageUrl: r.thumbnail, pageTitle: r.title || term }));
  } catch {
    return [];
  }
}


async function fetchCommonsImages(term, max = 1) {
  try {
    // Request more than needed so we can filter out SVG diagrams and still find a photo
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=${max * 4}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SkyWatch/1.0 (educational-platform)' } });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data.query?.pages ?? {});
    return pages
      .filter(p => {
        const t = (p.title ?? '').toLowerCase();
        return p.imageinfo?.[0]?.thumburl && (t.endsWith('.jpg') || t.endsWith('.jpeg') || t.endsWith('.png'));
      })
      .slice(0, max)
      .map(p => ({ imageUrl: p.imageinfo[0].thumburl, pageTitle: p.title?.replace(/^File:/, '') || term }));
  } catch {
    return [];
  }
}

async function resolveWikipediaPageTitle(term) {
  const searchRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=1&origin=*`
  );
  const searchData = await searchRes.json();
  return searchData.query?.search?.[0]?.title ?? null;
}

async function fetchWikipediaThumbnailUrl(pageTitle) {
  const thumbRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=800&origin=*`
  );
  const thumbData = await thumbRes.json();
  return Object.values(thumbData.query?.pages ?? {})[0]?.thumbnail?.source ?? null;
}

async function fetchWikipediaImages(term, max = 1) {
  try {
    const pageTitle = await resolveWikipediaPageTitle(term);
    if (!pageTitle) return [];
    const imageUrl = await fetchWikipediaThumbnailUrl(pageTitle);
    if (!imageUrl) return [];
    return [{ imageUrl, pageTitle }];
  } catch {
    return [];
  }
}

// Kept for external callers (e.g. scripts that resolve a single term)
async function resolveWikipediaImage(term) {
  const results = await fetchWikipediaImages(term);
  if (!results.length) return null;
  return { pageTitle: results[0].pageTitle, imageUrl: results[0].imageUrl };
}

const SOURCE_FETCHERS = {
  dvids:     fetchDvidsImages,
  commons:   fetchCommonsImages,
  wikipedia: fetchWikipediaImages,
};

async function downloadImage(imageUrl) {
  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'SkyWatch/1.0 (educational-platform)' } });
  if (!imgRes.ok) throw new Error(`Download failed (${imgRes.status})`);
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * For a single search term: check the DB first, then waterfall through the
 * requested sources until one produces an image. Deduplicates by search term,
 * Wikipedia page title (for the wikipedia source), and file content hash.
 */
async function getOrCreateMediaForTerm(term, { publicIdPrefix, sources = ALL_SOURCES }) {
  const normalizedTerm = Media.normalizeTerm(term);

  // Step 1 — DB check before touching any external API
  if (normalizedTerm) {
    const existing = await Media.findOne({
      $or: [
        { searchTermNormalized: normalizedTerm },
        { wikiPageTitleNormalized: normalizedTerm },
      ],
    });
    if (existing) return { media: existing, reused: true };
  }

  // Step 2 — waterfall through sources
  for (const source of sources) {
    const fetcher = SOURCE_FETCHERS[source];
    if (!fetcher) continue;

    let results;
    try {
      results = await fetcher(term, 1);
    } catch {
      continue;
    }
    if (!results.length) continue;

    const { imageUrl, pageTitle } = results[0];

    // For Wikipedia: secondary DB check by the resolved canonical page title —
    // different search terms may point at the same Wikipedia article
    if (source === 'wikipedia' && pageTitle) {
      const normalizedPage = Media.normalizeTerm(pageTitle);
      if (normalizedPage) {
        const existing = await Media.findOne({ wikiPageTitleNormalized: normalizedPage });
        if (existing) return { media: existing, reused: true };
      }
    }

    let buffer;
    try {
      buffer = await downloadImage(imageUrl);
    } catch {
      continue; // bad URL — try the next source
    }

    const contentHash = md5Hex(buffer);
    const existingByHash = await Media.findOne({ contentHash });
    if (existingByHash) return { media: existingByHash, reused: true };

    const upload = await uploadBuffer(buffer, { public_id: `${publicIdPrefix}-${Date.now()}` });

    const mediaData = {
      mediaType:          'picture',
      mediaUrl:           upload.secure_url,
      cloudinaryPublicId: upload.public_id,
      contentHash,
      name:               pageTitle || term,
      searchTerm:         term,
      showOnSummary:      true,
    };
    // Only set wikiPageTitle for the wikipedia source — the setter auto-computes
    // wikiPageTitleNormalized, and an empty-string value would pollute the index
    if (source === 'wikipedia' && pageTitle) {
      mediaData.wikiPageTitle = pageTitle;
    }

    const media = await Media.create(mediaData);
    return { media, reused: false };
  }

  return null;
}

/**
 * Generate images for a brief. Runs AI term extraction then waterfalls each
 * term through the requested sources. Non-fatal: failures are captured as
 * warnings and remaining terms are still attempted.
 */
async function generateBriefImages({ title, subtitle, imagePromptBase, publicIdPrefix = 'brief', sources = ALL_SOURCES }) {
  const warnings = [];
  let searchTerms = [];
  const mediaDocs = [];
  const seenIds = new Set();

  try {
    searchTerms = await extractSearchTerms({ title, subtitle, imagePromptBase });
  } catch (err) {
    warnings.push(`Image AI extraction failed: ${err.message}`);
    return { mediaDocs, searchTerms, warnings };
  }

  for (const term of searchTerms) {
    try {
      const result = await getOrCreateMediaForTerm(term, { publicIdPrefix, sources });
      if (!result) {
        warnings.push(`No image found for "${term}" across sources: ${sources.join(', ')}`);
        continue;
      }
      const idStr = String(result.media._id);
      if (seenIds.has(idStr)) continue;
      seenIds.add(idStr);
      mediaDocs.push(result.media);
    } catch (err) {
      warnings.push(`Image "${term}" failed: ${err.message}`);
    }
  }

  return { mediaDocs, searchTerms, warnings };
}

module.exports = {
  generateBriefImages,
  extractSearchTerms,
  resolveWikipediaImage,
  getOrCreateMediaForTerm,
  MAX_IMAGES,
  ALL_SOURCES,
};
