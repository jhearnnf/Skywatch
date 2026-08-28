// Stock footage search for Clipper stage 2.
//
// Three sources, queried in parallel and merged. Each returns [] on failure so
// one provider being down or unconfigured never fails the whole search — a beat
// with fewer candidates is workable, an error is not.
//
// Licence and sourceUrl are captured per clip. These end up in published
// videos, so "where did this come from and may we use it?" has to be answerable
// months later without re-running the search.

const LIBRARY_MAX = 8;
const DVIDS_MAX  = 8;
const PEXELS_MAX = 8;
const PIXABAY_MAX = 8;

const UA = 'SkyWatch/1.0 (educational-platform)';

const { searchLibrary, loadLibrary, libraryConfigured } = require('./clipperLibrary');

// Why a provider last returned nothing, keyed by provider name.
//
// Every search swallows its own failures so one dead source cannot fail the
// whole beat, and that is right — but it also means a *rejected API key* looks
// exactly like a search with no results. DVIDS sat in that state unnoticed: the
// key was present, so it reported as configured, and every query quietly fell
// through to Pexels and Pixabay. DVIDS is the only public-domain military and
// aviation source in the list, and losing it is most of the reason the stock in
// finished videos stopped looking like it belonged to this channel.
//
// Held in memory rather than persisted: it describes the last attempt, and the
// answer to a stale one is to search again.
const lastError = {};

function noteError(provider, reason) {
  if (reason) lastError[provider] = reason;
  else delete lastError[provider];
}

// Turn a failed response into something an admin can act on. An auth failure is
// the one worth naming, because it is the one that looks like success.
function describeResponse(res) {
  if (res.status === 401 || res.status === 403) return 'API key rejected';
  if (res.status === 429) return 'rate limited';
  return `HTTP ${res.status}`;
}

// ── DVIDS ───────────────────────────────────────────────────────────────────
// US DoD public domain. Best content fit by far for military and aviation
// b-roll, and the same endpoint the brief images already use — `type=video`
// rather than `type=image` is the only difference.
async function searchDvids(term, max = DVIDS_MAX) {
  const apiKey = process.env.DVIDS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.dvidshub.net/search?api_key=${encodeURIComponent(apiKey)}`
      + `&query=${encodeURIComponent(term)}&type=video&rows=${max}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { noteError('dvids', describeResponse(res)); return []; }
    const data = await res.json();
    noteError('dvids', null);
    return (data.results ?? [])
      .filter(r => r.id)
      .map(r => ({
        provider:    'dvids',
        providerId:  String(r.id),
        title:       r.title || term,
        thumbUrl:    r.thumbnail || null,
        // The search payload does not carry a direct file URL; the asset
        // endpoint does. The agent resolves it at download time.
        downloadUrl: null,
        assetUrl:    `https://api.dvidshub.net/asset?api_key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(r.id)}`,
        durationSec: Number(r.duration) || null,
        width:       null,
        height:      null,
        licence:     'Public domain (US DoD) - credit appreciated',
        sourceUrl:   r.url || `https://www.dvidshub.net/video/${r.id}`,
      }));
  } catch {
    noteError('dvids', 'request failed');
    return [];
  }
}

// ── Pexels ──────────────────────────────────────────────────────────────────
async function searchPexels(term, max = PEXELS_MAX) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(term)}`
      + `&per_page=${max}&orientation=portrait`;
    const res = await fetch(url, { headers: { Authorization: apiKey, 'User-Agent': UA } });
    if (!res.ok) { noteError('pexels', describeResponse(res)); return []; }
    const data = await res.json();
    noteError('pexels', null);
    return (data.videos ?? []).map(v => {
      // Prefer the largest file that is still <= 1080 wide. Anything bigger is
      // wasted bandwidth for a 1080x1920 composition.
      const files = (v.video_files ?? [])
        .filter(f => f.link)
        .sort((a, b) => (b.width || 0) - (a.width || 0));
      const best = files.find(f => (f.width || 0) <= 1080) || files[0];
      return {
        provider:    'pexels',
        providerId:  String(v.id),
        title:       v.user?.name ? `Pexels clip by ${v.user.name}` : `Pexels ${v.id}`,
        thumbUrl:    v.image || null,
        downloadUrl: best?.link || null,
        assetUrl:    null,
        durationSec: Number(v.duration) || null,
        width:       best?.width || v.width || null,
        height:      best?.height || v.height || null,
        licence:     'Pexels licence - free to use, no attribution required',
        sourceUrl:   v.url || null,
      };
    }).filter(c => c.downloadUrl);
  } catch {
    noteError('pexels', 'request failed');
    return [];
  }
}

// ── Pixabay ─────────────────────────────────────────────────────────────────
async function searchPixabay(term, max = PIXABAY_MAX) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}`
      + `&q=${encodeURIComponent(term)}&per_page=${Math.max(3, max)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { noteError('pixabay', describeResponse(res)); return []; }
    const data = await res.json();
    noteError('pixabay', null);
    return (data.hits ?? []).map(h => {
      const v = h.videos || {};
      const pick = v.medium || v.small || v.large || v.tiny || {};
      return {
        provider:    'pixabay',
        providerId:  String(h.id),
        title:       h.tags ? `Pixabay: ${h.tags}` : `Pixabay ${h.id}`,
        thumbUrl:    pick.thumbnail || null,
        downloadUrl: pick.url || null,
        assetUrl:    null,
        durationSec: Number(h.duration) || null,
        width:       pick.width || null,
        height:      pick.height || null,
        licence:     'Pixabay content licence - free to use',
        sourceUrl:   h.pageURL || null,
      };
    }).filter(c => c.downloadUrl);
  } catch {
    noteError('pixabay', 'request failed');
    return [];
  }
}

// ── Curated library ─────────────────────────────────────────────────────────
// Clips we chose ourselves, searched alongside the stock APIs so a beat sees
// them next to each other and the better one wins. See utils/clipperLibrary.js.
async function searchLocalLibrary(term, max = LIBRARY_MAX) {
  try {
    const results = searchLibrary(term, max);
    // A malformed manifest entry is worth naming for the same reason a rejected
    // API key is: the search still returns results, so nothing looks wrong.
    const { problems } = loadLibrary();
    noteError('library', problems.length ? problems[0] : null);
    return results;
  } catch {
    noteError('library', 'library.json could not be read');
    return [];
  }
}

const PROVIDERS = {
  dvids: searchDvids, pexels: searchPexels, pixabay: searchPixabay,
  library: searchLocalLibrary,
};

function configuredProviders() {
  return {
    dvids:   Boolean(process.env.DVIDS_API_KEY),
    pexels:  Boolean(process.env.PEXELS_API_KEY),
    pixabay: Boolean(process.env.PIXABAY_API_KEY),
    // Not a key but the same question: is there anything here to search?
    library: libraryConfigured(),
  };
}

// Which providers are configured, and which of those are configured but not
// actually working. "Configured" only ever meant "a key is set", which is why a
// rejected key has been indistinguishable from a quiet search.
function providerStatus() {
  const configured = configuredProviders();
  const failing = {};
  for (const name of Object.keys(configured)) {
    if (configured[name] && lastError[name]) failing[name] = lastError[name];
  }
  return { configured, failing };
}

// Interleave results so the candidate strip does not open with eight clips from
// whichever provider happened to answer first — the admin should see the range
// available without scrolling.
function interleave(lists) {
  const out = [];
  const maxLen = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

// ── Relevance ───────────────────────────────────────────────────────────────
//
// Nothing used to rank these. Three providers were queried, their results were
// interleaved, and the first eighteen were kept — so a clip's position in the
// strip recorded which API answered fastest and nothing about whether it suited
// the line it would sit under. That is most of why a finished video's pictures
// did not match its words: the admin chose from an order that carried no signal
// and, choosing left to right, mostly took whatever landed first.
//
// The signal available is thin (a Pexels clip's "title" is the photographer's
// name) but it is not nothing: Pixabay ships its tags, DVIDS and the curated
// library ship real titles. Score what we can, leave the rest at zero, and let
// a clip that actually says "cockpit" beat one that says nothing.

// Words that would match everything and so separate nothing.
const RELEVANCE_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'is', 'are', 'be', 'it', 'its', 'this', 'that', 'you', 'your', 'they',
  'video', 'clip', 'footage', 'stock', 'free', 'pexels', 'pixabay', 'by',
]);

function relevanceTokens(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .filter(w => !RELEVANCE_STOPWORDS.has(w));
}

// How well one candidate answers this beat.
//
// The query is weighted far above the beat text on purpose. The query names the
// thing to film; the beat text is the line it plays under, and matching it is a
// bonus rather than the job — a beat about "sixty seconds" should not pull up
// clips of clocks ahead of the aircraft the query asked for.
function scoreCandidate(candidate, queryTokens, beatTokens) {
  const haystack = new Set(relevanceTokens(
    `${candidate.title || ''} ${candidate.sourceUrl || ''}`,
  ));

  let score = 0;
  for (const t of queryTokens) if (haystack.has(t)) score += 4;
  for (const t of beatTokens)  if (haystack.has(t)) score += 1;

  // Source priors. The curated library is clips somebody watched and kept, and
  // DVIDS is public-domain military and aviation: both are likelier to belong
  // on this channel than a generic stock hit, and neither describes itself as
  // richly as Pixabay does, so a small prior stops good sources sinking purely
  // for having terser metadata.
  if (candidate.provider === 'library') score += 5;
  if (candidate.provider === 'dvids')   score += 3;

  // Portrait clips need no cropping into a 9:16 frame.
  if (candidate.width && candidate.height && candidate.height > candidate.width) score += 2;

  return score;
}

// Rank by relevance, but never let one provider take the whole strip: an admin
// scanning left to right should still see the range available. Best clip first,
// then the best from a different provider, and so on until the tie is spent.
function rankCandidates(candidates, { queryTokens, beatTokens }) {
  const scored = candidates
    .map((c, i) => ({ c, i, score: scoreCandidate(c, queryTokens, beatTokens) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i));

  const byProvider = new Map();
  for (const row of scored) {
    if (!byProvider.has(row.c.provider)) byProvider.set(row.c.provider, []);
    byProvider.get(row.c.provider).push(row.c);
  }
  return interleave([...byProvider.values()]);
}

// `beatText` is the spoken line this clip will play under. Optional: a search
// run by hand from the footage stage has a term and nothing else.
async function searchFootage(term, { providers, limit = 18, beatText = '' } = {}) {
  const query = String(term || '').trim();
  if (!query) return [];

  const names = (providers && providers.length ? providers : Object.keys(PROVIDERS))
    .filter(n => PROVIDERS[n]);

  const settled = await Promise.all(names.map(n => PROVIDERS[n](query)));

  const queryTokens = relevanceTokens(query);
  const beatTokens  = relevanceTokens(beatText).filter(t => !queryTokens.includes(t));

  return rankCandidates(settled.flat(), { queryTokens, beatTokens }).slice(0, limit);
}

module.exports = {
  searchFootage,
  searchLocalLibrary,
  providerStatus,
  // Exported so tests can start from a known state - the map is module-level
  // and would otherwise leak between cases.
  _resetProviderErrors: () => { for (const k of Object.keys(lastError)) delete lastError[k]; },
  searchDvids,
  searchPexels,
  searchPixabay,
  configuredProviders,
  interleave,
  rankCandidates,
  scoreCandidate,
  relevanceTokens,
  PROVIDERS,
};
