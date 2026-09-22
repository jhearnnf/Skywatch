// The device a problem report was filed from: what the client sends, what the
// request header says, and the plain-English summary the admin card shows.
//
// Two halves. sanitiseReportEnvironment() runs at write time and admits only
// the fields it knows, each capped and typed — these strings come off the wire
// and end up rendered in the admin panel. describeReportEnvironment() runs at
// read time and turns the stored values into "Windows 11 · Chrome 128 ·
// 1920×1080" lines, so a better parser applies to every report already filed
// rather than only to the ones after it shipped.
//
// The User-Agent header is kept on the server's authority, not the client's:
// it arrives even from a bundle built before the client sent any environment
// at all, so every report going forward has at least an OS family and browser.

const STR  = (max) => ({ kind: 'string', max });
const NUM  = { kind: 'number' };
const BOOL = { kind: 'boolean' };

const FIELDS = {
  userAgent:         STR(400),
  uaPlatform:        STR(40),
  uaPlatformVersion: STR(40),
  uaModel:           STR(80),
  uaArchitecture:    STR(20),
  uaBitness:         STR(8),
  uaMobile:          BOOL,
  screenWidth:       NUM,
  screenHeight:      NUM,
  viewportWidth:     NUM,
  viewportHeight:    NUM,
  dpr:               NUM,
  orientation:       STR(40),
  touchPoints:       NUM,
  language:          STR(20),
  timezone:          STR(60),
  online:            BOOL,
  connection:        STR(20),
  cores:             NUM,
  memory:            NUM,
  webglVendor:       STR(120),
  webglRenderer:     STR(300),
  theme:             STR(20),
  displayMode:       STR(20),
  fullscreen:        BOOL,
};

const MAX_BRANDS   = 8;
const MAX_GAMEPADS = 4;

function cleanString(v, max) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') return undefined;
  // Control characters have no business in a version string or a GPU name.
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanNumber(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) < 1e9 ? n : undefined;
}

// Returns a plain object of the admissible fields, or null when nothing usable
// arrived. `userAgentHeader` wins over anything the client claimed.
function sanitiseReportEnvironment(raw, userAgentHeader) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};

  for (const [key, rule] of Object.entries(FIELDS)) {
    const v = src[key];
    let clean;
    if (rule.kind === 'string')  clean = cleanString(v, rule.max);
    if (rule.kind === 'number')  clean = cleanNumber(v);
    if (rule.kind === 'boolean') clean = typeof v === 'boolean' ? v : undefined;
    if (clean !== undefined) out[key] = clean;
  }

  const ua = cleanString(userAgentHeader, 400);
  if (ua) out.userAgent = ua;

  if (Array.isArray(src.uaBrands)) {
    const brands = src.uaBrands
      .map(b => ({ brand: cleanString(b?.brand, 60), version: cleanString(b?.version, 40) }))
      .filter(b => b.brand)
      .map(b => (b.version ? b : { brand: b.brand }))
      .slice(0, MAX_BRANDS);
    if (brands.length) out.uaBrands = brands;
  }

  if (Array.isArray(src.gamepads)) {
    const pads = src.gamepads.map(g => cleanString(g, 120)).filter(Boolean).slice(0, MAX_GAMEPADS);
    if (pads.length) out.gamepads = pads;
  }

  return Object.keys(out).length ? out : null;
}

// ── Description ─────────────────────────────────────────────────────────────

// Chromium's frozen UA reports every Windows as NT 10.0 and every macOS as
// 10.15.7. The Client Hints platformVersion is the only honest source: on
// Windows it is the UniversalApiContract version, where 13+ means Windows 11.
function windowsFromPlatformVersion(pv) {
  const major = parseInt(String(pv).split('.')[0], 10);
  if (!Number.isFinite(major)) return 'Windows';
  if (major >= 13) return 'Windows 11';
  if (major >= 1)  return 'Windows 10';
  return 'Windows 8.1 or earlier';
}

function trimVersion(v, parts = 2) {
  return String(v).split('.').filter(x => x !== '').slice(0, parts).join('.');
}

function osFromHints(env) {
  const p = env.uaPlatform;
  if (!p) return null;
  const pv = env.uaPlatformVersion;
  switch (p) {
    case 'Windows':   return pv ? windowsFromPlatformVersion(pv) : 'Windows';
    case 'macOS':     return pv ? `macOS ${trimVersion(pv)}` : 'macOS';
    case 'Android':   return pv ? `Android ${trimVersion(pv, 1)}` : 'Android';
    case 'Chrome OS':
    case 'ChromeOS':  return pv ? `ChromeOS ${trimVersion(pv, 1)}` : 'ChromeOS';
    case 'Linux':     return 'Linux';
    case 'iOS':       return pv ? `iOS ${trimVersion(pv)}` : 'iOS';
    default:          return pv ? `${p} ${trimVersion(pv)}` : p;
  }
}

function osFromUa(ua) {
  const s = String(ua ?? '');
  if (!s) return null;
  let m;
  if ((m = s.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/)))       return `iOS ${m[1]}.${m[2]}`;
  if (/iPhone|iPad|iPod/.test(s))                                        return 'iOS';
  if ((m = s.match(/Android (\d+(?:\.\d+)?)/)))                          return `Android ${m[1]}`;
  if (/Android/i.test(s))                                                return 'Android';
  if (/Windows NT 10\.0/.test(s))                                        return 'Windows 10 or 11';
  if ((m = s.match(/Windows NT (\d+\.\d+)/)))                            return `Windows NT ${m[1]}`;
  if (/Windows/i.test(s))                                                return 'Windows';
  if ((m = s.match(/Mac OS X (\d+)[_.](\d+)/))) {
    // Frozen at 10.15.7 by Chrome and Safari alike; say so rather than lie.
    return m[1] === '10' && m[2] === '15' ? 'macOS (10.15 or later)' : `macOS ${m[1]}.${m[2]}`;
  }
  if (/Macintosh/.test(s))                                               return 'macOS';
  if (/CrOS/.test(s))                                                    return 'ChromeOS';
  if (/Linux/i.test(s))                                                  return 'Linux';
  return null;
}

// Brands to skip when picking the browser from the Client Hints list. The
// GREASE entries are deliberately nonsense; "Chromium" is the engine, which
// every Chromium browser also lists, so a named brand beside it is the answer.
const GENERIC_BRANDS = /Not.?A.?Brand|^Chromium$/i;

function browserFromHints(env) {
  const brands = Array.isArray(env.uaBrands) ? env.uaBrands : [];
  if (!brands.length) return null;
  const named = brands.find(b => !GENERIC_BRANDS.test(b.brand))
             || brands.find(b => /^Chromium$/i.test(b.brand));
  if (!named) return null;
  const name = named.brand === 'Google Chrome' ? 'Chrome' : named.brand;
  return named.version ? `${name} ${trimVersion(named.version, 1)}` : name;
}

function browserFromUa(ua) {
  const s = String(ua ?? '');
  if (!s) return null;
  let m;
  const webview = /; wv\)/.test(s) || /\bVersion\/[\d.]+.*Chrome\//.test(s) && /Android/.test(s);
  if ((m = s.match(/Edg(?:e|A|iOS)?\/(\d+)/)))          return `Edge ${m[1]}`;
  if ((m = s.match(/OPR\/(\d+)/)))                      return `Opera ${m[1]}`;
  if ((m = s.match(/SamsungBrowser\/(\d+)/)))           return `Samsung Internet ${m[1]}`;
  if ((m = s.match(/(?:Firefox|FxiOS)\/(\d+)/)))        return `Firefox ${m[1]}`;
  if ((m = s.match(/CriOS\/(\d+)/)))                    return `Chrome ${m[1]} (iOS)`;
  if ((m = s.match(/Chrome\/(\d+)/)))                   return webview ? `Android WebView (Chrome ${m[1]})` : `Chrome ${m[1]}`;
  if (/Safari\//.test(s) && (m = s.match(/Version\/(\d+(?:\.\d+)?)/))) return `Safari ${m[1]}`;
  if (/Safari\//.test(s))                               return 'Safari';
  return null;
}

// "Android WebView" from the UA is what the installed app runs in; when the
// client already said it is the app, say that first and keep the engine
// version because it is the thing that actually varies between devices.
function browserLabel(env, clientPlatform) {
  const fromUa = browserFromUa(env.userAgent);
  const fromHints = browserFromHints(env);
  const isWebview = /; wv\)/.test(String(env.userAgent ?? ''));
  const native = clientPlatform === 'android' || clientPlatform === 'ios';
  if (native || isWebview) {
    const engine = (fromUa && fromUa.match(/Chrome \d+/)?.[0]) || fromHints || fromUa;
    return `SkyWatch app${engine ? ` (WebView, ${engine})` : ''}`;
  }
  return fromHints || fromUa;
}

function deviceLabel(env) {
  const parts = [];
  if (env.uaModel) parts.push(env.uaModel);
  else {
    const ua = String(env.userAgent ?? '');
    let m;
    if (/iPad/.test(ua)) parts.push('iPad');
    else if (/iPhone/.test(ua)) parts.push('iPhone');
    // Pre-reduction Android UAs carry "; <model> Build/"; the reduced one says "K".
    else if ((m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/|\))/)) && m[1].trim() !== 'K') parts.push(m[1].trim());
  }
  if (env.uaMobile === true) parts.push('mobile');
  else if (env.uaMobile === false && env.touchPoints === 0) parts.push('desktop');
  if (env.uaArchitecture) parts.push(`${env.uaArchitecture}${env.uaBitness ? ` ${env.uaBitness}-bit` : ''}`);
  return parts.length ? parts.join(' · ') : null;
}

function screenLabel(env) {
  const parts = [];
  if (env.screenWidth && env.screenHeight) parts.push(`screen ${env.screenWidth}×${env.screenHeight}`);
  if (env.viewportWidth && env.viewportHeight) parts.push(`viewport ${env.viewportWidth}×${env.viewportHeight}`);
  if (env.dpr && env.dpr !== 1) parts.push(`@${Number(env.dpr.toFixed(2))}x`);
  if (env.orientation) parts.push(env.orientation.replace(/-primary|-secondary/, ''));
  if (typeof env.touchPoints === 'number') parts.push(env.touchPoints > 0 ? `touch (${env.touchPoints})` : 'no touch');
  if (env.fullscreen) parts.push('fullscreen');
  return parts.length ? parts.join(', ') : null;
}

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" is
// how Chrome on Windows names a GPU; the middle part is the name.
function gpuLabel(env) {
  const r = env.webglRenderer;
  if (!r) return null;
  if (r === 'unavailable') return 'WebGL unavailable';
  const angle = r.match(/^ANGLE \((.*)\)$/);
  if (angle) {
    const inner = angle[1].split(',').map(s => s.trim());
    const name = (inner.length >= 2 ? inner[1] : inner[0])
      .replace(/\s+(Direct3D\d+|OpenGL|Vulkan|Metal).*$/, '')
      .trim();
    const backend = inner[inner.length - 1];
    return /^(D3D\d+|OpenGL|Vulkan|Metal)/.test(backend) && inner.length >= 3 ? `${name} (${backend})` : name;
  }
  return r;
}

function otherLabel(env) {
  const parts = [];
  if (env.theme && env.theme !== 'skywatch') parts.push(`${env.theme} theme`);
  if (env.displayMode && env.displayMode !== 'browser') parts.push(`installed (${env.displayMode})`);
  if (env.online === false) parts.push('offline at the time');
  if (env.connection) parts.push(env.connection);
  if (env.language) parts.push(env.language);
  if (env.timezone) parts.push(env.timezone);
  if (env.cores) parts.push(`${env.cores} cores`);
  if (env.memory) parts.push(`${env.memory}GB+ RAM`);
  return parts.length ? parts.join(' · ') : null;
}

// Rows for the admin card, in reading order, with anything unknown left out.
// `clientPlatform` is the report's own field (web/android/ios) and decides
// whether a Chromium WebView is described as the app.
function describeReportEnvironment(env, { clientPlatform } = {}) {
  if (!env || typeof env !== 'object') return [];
  const rows = [
    ['OS',       osFromHints(env) || osFromUa(env.userAgent)],
    ['Browser',  browserLabel(env, clientPlatform)],
    ['Device',   deviceLabel(env)],
    ['Display',  screenLabel(env)],
    ['Graphics', gpuLabel(env)],
    ['Controls', Array.isArray(env.gamepads) && env.gamepads.length ? env.gamepads.join(', ') : null],
    ['Other',    otherLabel(env)],
  ];
  return rows.filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}

module.exports = {
  sanitiseReportEnvironment,
  describeReportEnvironment,
  // Exposed for tests.
  osFromUa,
  browserFromUa,
  gpuLabel,
};
