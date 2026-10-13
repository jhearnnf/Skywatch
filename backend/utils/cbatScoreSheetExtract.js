// Reads one photographed "Aptitude Scores" page into the shape models/CbatScoreSheet.js stores.
//
// The model only transcribes; everything after that is ours and pure, so it is tested without a
// network: `parseExtraction` turns whatever the model wrote into clean numbers, and
// `batteryKeyFor` maps a printed role name onto our battery key across every naming the sheets
// have used (they rename roles between years, which is half the point of keeping the data).

const { callOpenRouter } = require('./openRouter');
const { ANY_BATTERY_BY_KEY } = require('../constants/cbatBatteries');

// The same Sonnet the rest of the backend already calls through OpenRouter. A dense, skewed phone
// photo of a table is the hardest reading job the app has, so not Haiku.
const EXTRACT_MODEL = 'anthropic/claude-sonnet-4-5';

const PROMPT = `This is a photo of one page of a printed "Aptitude Scores" sheet from a military aptitude test.
Transcribe the score table into JSON. Read every role (battery) on the page.

Return ONLY a JSON object, no prose:
{
  "isScoreSheet": true,
  "testDate": "YYYY-MM-DD" or null,
  "board": "RAF" or null,
  "batteries": [
    {
      "label": "role name exactly as printed, e.g. RAF Pilot 2026",
      "sideBar": 1,
      "verdict": "pass" | "fail" | null,
      "cutoff": 112,
      "score": 123,
      "domains": [
        { "key": "StrgcTM", "weight": 17, "tests": [{ "code": "CUT", "mult": 3 }, { "code": "SAT", "mult": 1 }],
          "stanine": 6, "minStanine": 4, "belowMinimum": false }
      ]
    }
  ]
}

Rules:
- Do NOT include any name, date of birth, candidate number or other personal detail. Only the fields above.
- "sideBar": the coloured PASS/FAIL bar down the left is often shared by several roles. Number the bars from the top of the page (1, 2, 3...) and give each role the number of the bar beside it. Roles beside the same bar get the same number. "verdict" is that bar's word.
- "weight" is the Dom Wgt number without the "x". A test written 3(CUT) or 3CUT is { "code": "CUT", "mult": 3 }; (2SIT) is { "code": "SIT", "mult": 2 }. Keep codes as printed (TRAC 2, TRAC_PT2, VGIL_SPEED and so on).
- "stanine" is the column (1-9) where the green bar ends. "minStanine" is the column holding the small red tick marks, or the solid red bar. "belowMinimum" is true only when a solid red bar is drawn because the green bar falls short of it.
- Use null for anything you cannot read. Never guess a number.
- If the page is not a score sheet, return { "isScoreSheet": false }.`;

const int = (v, lo, hi) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r < lo || r > hi ? null : r;
};

// A printed role name to our battery key. The sheets have called the same role several things
// ("Pilot", "RAF Pilot 2025", "RAF Pilot 2026"; "Air & Space Ops - Control Officer (ATC)",
// "Control Officer (ATC)"; "Non-Commissioned Control (ATC)", "Air Traffic & Weapons Controller
// (ATC)"), so the label is squashed to letters and matched against every spelling seen.
const LABEL_KEYS = {
  pilot: 'pilot',
  pilotisrrpas: 'pilot-isr-rpas',
  weaponsystemsofficer: 'wso',
  wso: 'wso',
  controlofficeratc: 'control-officer-atc',
  controlofficerwc: 'control-officer-wc',
  operationsofficer: 'operations-officer',
  intelligence: 'intelligence',
  intelligenceofficer: 'intelligence',
  wsopairsignallerlinguist: 'wsop-linguist',
  wsoplinguist: 'wsop-linguist',
  wsopisr: 'wsop-isr',
  wsoprw: 'wsop-rw',
  wsopam: 'wsop-am',
  noncommissionedcontrolatc: 'nco-control-atc',
  noncommissionedcontrolwc: 'nco-control-wc',
  airtrafficweaponscontrolleratc: 'nco-control-atc',
  airtrafficweaponscontrollerwc: 'nco-control-wc',
};

function batteryKeyFor(label) {
  const squashed = String(label ?? '')
    .toLowerCase()
    .replace(/\b(19|20)\d\d\b/g, '')
    .replace(/[^a-z]/g, '')
    .replace(/^raf/, '')
    .replace(/^airspaceops/, '');
  const key = LABEL_KEYS[squashed] ?? null;
  return key && ANY_BATTERY_BY_KEY[key] ? key : null;
}

function cleanDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cleanDomain(d) {
  return {
    key: String(d?.key ?? '').trim() || '?',
    weight: int(d?.weight, 0, 100),
    tests: (Array.isArray(d?.tests) ? d.tests : [])
      .map(t => ({ code: String(t?.code ?? '').trim(), mult: int(t?.mult, 1, 9) ?? 1 }))
      .filter(t => t.code),
    stanine: int(d?.stanine, 1, 9),
    minStanine: int(d?.minStanine, 1, 9),
    belowMinimum: typeof d?.belowMinimum === 'boolean' ? d.belowMinimum : null,
  };
}

function cleanBattery(b) {
  const label = String(b?.label ?? '').replace(/\s+/g, ' ').trim();
  const verdict = String(b?.verdict ?? '').toLowerCase();
  return {
    label: label || '?',
    batteryKey: batteryKeyFor(label),
    sideBar: int(b?.sideBar, 1, 50),
    verdict: verdict === 'pass' || verdict === 'fail' ? verdict : null,
    cutoff: int(b?.cutoff, 0, 180),
    score: int(b?.score, 0, 180),
    domains: (Array.isArray(b?.domains) ? b.domains : []).map(cleanDomain),
  };
}

// The model's reply, which may wrap the JSON in prose or a code fence, to clean fields.
// Returns null when there is no JSON in it at all.
function parseExtraction(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let raw;
  try { raw = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (raw?.isScoreSheet === false) return { isScoreSheet: false, testDate: null, board: null, batteries: [] };
  return {
    isScoreSheet: true,
    testDate: cleanDate(raw?.testDate),
    board: typeof raw?.board === 'string' && raw.board.trim() ? raw.board.trim().slice(0, 20) : null,
    batteries: (Array.isArray(raw?.batteries) ? raw.batteries : []).map(cleanBattery),
  };
}

// Fetches the photo and has the model read it. `chat` is injectable for tests.
async function extractScoreSheet(imageUrl, { chat = callOpenRouter, fetchImpl = fetch } = {}) {
  const img = await fetchImpl(imageUrl);
  if (!img.ok) throw new Error(`Could not fetch the image (${img.status})`);
  const type = img.headers.get('content-type') || 'image/jpeg';
  const b64 = Buffer.from(await img.arrayBuffer()).toString('base64');

  const data = await chat({
    key: 'main',
    feature: 'cbat-score-sheet-extract',
    body: {
      model: EXTRACT_MODEL,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${type};base64,${b64}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    },
  });
  const parsed = parseExtraction(data?.choices?.[0]?.message?.content);
  if (!parsed) throw new Error('The model did not return a readable table');
  return { ...parsed, model: EXTRACT_MODEL };
}

module.exports = { extractScoreSheet, parseExtraction, cleanBattery, cleanDate, batteryKeyFor, EXTRACT_MODEL };
