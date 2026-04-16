const crypto = require('crypto');
const Media = require('../models/Media');
const { uploadBuffer } = require('./cloudinary');

function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

const MAX_IMAGES = 2;

async function extractSearchTerms({ title, subtitle, imagePromptBase }) {
  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title': 'SkyWatch',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `${imagePromptBase}\n\nTitle: "${title}"${subtitle ? `\nSubtitle: "${subtitle}"` : ''}`,
      }],
    }),
  });
  const data = await aiRes.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]';
  let terms = [];
  try { terms = JSON.parse(raw.replace(/```json\n?|```/g, '').trim()); } catch { terms = [title]; }
  if (!Array.isArray(terms) || !terms.length) terms = [title];
  return terms.slice(0, MAX_IMAGES);
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

async function resolveWikipediaImage(term) {
  const pageTitle = await resolveWikipediaPageTitle(term);
  if (!pageTitle) return null;
  const imageUrl = await fetchWikipediaThumbnailUrl(pageTitle);
  if (!imageUrl) return null;
  return { pageTitle, imageUrl };
}

async function downloadImage(imageUrl) {
  const imgRes = await fetch(imageUrl, { headers: { 'User-Agent': 'SkyWatch/1.0 (educational-platform)' } });
  if (!imgRes.ok) throw new Error(`Download failed (${imgRes.status})`);
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * For a single search term: look up an existing Media doc first (by term, then
 * by resolved Wikipedia page title). If none exists, download from Wikipedia,
 * upload to Cloudinary, and create a new Media doc. Returns the Media doc (or
 * null if Wikipedia had nothing for this term).
 */
async function getOrCreateMediaForTerm(term, { publicIdPrefix }) {
  const normalizedTerm = Media.normalizeTerm(term);

  // Step 1 — check DB before touching Wikipedia / Cloudinary
  if (normalizedTerm) {
    const existing = await Media.findOne({
      $or: [
        { searchTermNormalized: normalizedTerm },
        { wikiPageTitleNormalized: normalizedTerm },
      ],
    });
    if (existing) return { media: existing, reused: true };
  }

  // Step 2 — resolve to a Wikipedia page title (so we know the canonical title)
  const pageTitle = await resolveWikipediaPageTitle(term);
  if (!pageTitle) return null;

  // Step 3 — check DB by the resolved page title BEFORE fetching the
  // thumbnail (different terms may point at the same page — short-circuit
  // to avoid an unnecessary Wikipedia call)
  const normalizedPage = Media.normalizeTerm(pageTitle);
  if (normalizedPage) {
    const existing = await Media.findOne({ wikiPageTitleNormalized: normalizedPage });
    if (existing) return { media: existing, reused: true };
  }

  // Step 4 — fetch the image URL for this page
  const imageUrl = await fetchWikipediaThumbnailUrl(pageTitle);
  if (!imageUrl) return null;

  // Step 5 — download the image, then hash-check before uploading. This
  // catches cases where a completely different term/page resolves to the
  // same underlying file bytes (e.g. two Wikipedia pages sharing a photo).
  const buffer = await downloadImage(imageUrl);
  const contentHash = md5Hex(buffer);

  const existingByHash = await Media.findOne({ contentHash });
  if (existingByHash) return { media: existingByHash, reused: true };

  // Step 5 — new image: upload + persist
  const upload = await uploadBuffer(buffer, {
    public_id: `${publicIdPrefix}-${Date.now()}`,
  });
  const media = await Media.create({
    mediaType: 'picture',
    mediaUrl: upload.secure_url,
    cloudinaryPublicId: upload.public_id,
    contentHash,
    name: pageTitle || term,
    searchTerm: term,
    wikiPageTitle: pageTitle,
    showOnSummary: true,
  });
  return { media, reused: false };
}

/**
 * Generate images for a brief. Runs AI extraction, deduplicates each term
 * against existing Media, downloads + uploads the rest. Non-fatal: any
 * individual failure is captured as a warning and the remaining terms are
 * still attempted.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {string} opts.imagePromptBase  getPrompt(settings, 'imageExtraction')
 * @param {string} [opts.publicIdPrefix] Cloudinary public_id prefix, e.g. 'brief'
 * @returns {Promise<{ mediaDocs: object[], searchTerms: string[], warnings: string[] }>}
 */
async function generateBriefImages({ title, subtitle, imagePromptBase, publicIdPrefix = 'brief' }) {
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
      const result = await getOrCreateMediaForTerm(term, { publicIdPrefix });
      if (!result) {
        warnings.push(`No Wikipedia image for "${term}"`);
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
};
