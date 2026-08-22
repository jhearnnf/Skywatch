// Stock footage search for Clipper stage 2.
//
// Three sources, queried in parallel and merged. Each returns [] on failure so
// one provider being down or unconfigured never fails the whole search — a beat
// with fewer candidates is workable, an error is not.
//
// Licence and sourceUrl are captured per clip. These end up in published
// videos, so "where did this come from and may we use it?" has to be answerable
// months later without re-running the search.

const DVIDS_MAX  = 8;
const PEXELS_MAX = 8;
const PIXABAY_MAX = 8;

const UA = 'SkyWatch/1.0 (educational-platform)';


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
    return [];
  }
}

const PROVIDERS = { dvids: searchDvids, pexels: searchPexels, pixabay: searchPixabay };

function configuredProviders() {
  return {
    dvids:   Boolean(process.env.DVIDS_API_KEY),
    pexels:  Boolean(process.env.PEXELS_API_KEY),
    pixabay: Boolean(process.env.PIXABAY_API_KEY),
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

async function searchFootage(term, { providers, limit = 18 } = {}) {
  const query = String(term || '').trim();
  if (!query) return [];

  const names = (providers && providers.length ? providers : Object.keys(PROVIDERS))
    .filter(n => PROVIDERS[n]);

  const settled = await Promise.all(names.map(n => PROVIDERS[n](query)));
  return interleave(settled).slice(0, limit);
}

module.exports = {
  searchFootage,
  providerStatus,
  // Exported so tests can start from a known state - the map is module-level
  // and would otherwise leak between cases.
  _resetProviderErrors: () => { for (const k of Object.keys(lastError)) delete lastError[k]; },
  searchDvids,
  searchPexels,
  searchPixabay,
  configuredProviders,
  interleave,
  PROVIDERS,
};
