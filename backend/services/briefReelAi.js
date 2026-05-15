// Brief Reel AI — generates a structured "stickman animation" timeline for a
// single intel-brief description section. The AI writes only the *script*; the
// frontend renderer owns the visual style by drawing from a fixed library of
// SVG primitives keyed by the enums below. That separation is what keeps the
// look consistent across reels — the AI cannot invent visuals we can't draw.

const { callOpenRouter } = require('../utils/openRouter');

// ── Closed enums ────────────────────────────────────────────────────────────
// Anything outside these sets is dropped at validation time. Add new entries
// here AND add the corresponding renderer primitive on the frontend.

const FACTIONS = new Set([
  'raf-primary',    // bright orange — the figure being profiled/quoted
  'raf-secondary',  // brand blue — other RAF figures
  'ally',           // off-white — allied non-RAF (US/French/NATO)
  'civilian',       // slate-grey — analysts/journalists/officials
  'adversary',      // muted red — opposing force (no flags, no caricature)
]);

const HEADGEAR = new Set([
  'cap-acm',         // peaked cap, full braid — very senior officer
  'cap-officer',     // peaked cap — officer
  'beret',           // beret — soldier / SAS
  'flight-helmet',   // pilot helmet
  'combat-helmet',   // ground combat helmet
  'hardhat',         // engineer / industry
  'civilian-hat',    // suit / civilian dignitary
  'none',
]);

const PROP_TYPES = new Set([
  'laptop',
  'document',
  'flag',
  'aircraft-typhoon',
  'aircraft-f35',
  'aircraft-generic',
  'helicopter',
  'drone-uav',
  'missile',
  'building',
  'sky-bg',
  'map',
]);

const ACTION_TYPES = new Set([
  'enter',         // actor walks in from offstage
  'exit',          // actor walks off
  'salute',        // RAF salute (one-shot gesture)
  'speak',         // speech bubble — params.text
  'point',         // point at another actor/prop — params.targetId
  'argue',         // two-actor argument — params.targetActorId
  'walk-to',       // params.position: 'left' | 'centre' | 'right'
  'throw-up',      // toss a held prop into the sky — params.propId
  'pilot',         // mount a propId (aircraft) and fly
  'show-name',     // briefly render the actor's full name above their head
  'show-text',     // CALLOUT — big centre-stage phrase that slides in, holds, slides out
  'show-stat',     // CALLOUT — big number + caption (e.g. "+12%" + "YoY recruitment")
  'show-date',     // CALLOUT — date stamp (e.g. "2026" or "Q3 2025")
  'crossout',      // strike a big red X over the active callout — use AFTER a
                   // show-text/show-stat/show-date in the SAME beat when the
                   // section frames that fact as superseded/abandoned/revised
  'flyby',         // 3D aircraft flyby — 2 real RAF airframe GLBs cross the
                   // scene in opposite directions. Use for ambient aircraft
                   // mentions; reserve 'pilot' for specific named operators.
  'pulse',         // brief scale-bump on actor/prop — params.targetId
  'background',    // swap stage background — params.propId (sky-bg or map)
]);

// ── Prompt building ─────────────────────────────────────────────────────────

const SCHEMA_DOC = `You output a Brief Reel timeline as a single JSON object. Schema:

{
  "version": 1,
  "totalDurationMs": <int — sum of beats[].durationMs, between 8000 and 30000>,
  "actors": [
    {
      "id": "a1",                            // unique short id
      "name": "Air Chief Marshal Harvey Smyth",
      "shortLabel": "ACM Smyth",             // <= 24 chars, used when name won't fit
      "faction": "raf-primary",              // one of: ${[...FACTIONS].join(', ')}
      "headgear": "cap-acm",                 // one of: ${[...HEADGEAR].join(', ')}
      "rank": 18                             // optional. RAF rank number 1-19 for raf-primary/raf-secondary only.
                                             // Renderer draws the actual rank insignia above the hat. Omit for civilian/ally/adversary.
                                             // Mapping: 1=Aircraftman, 2=LAC, 3=SAC, 4=Cpl, 5=Sgt, 6=Ch Tech, 7=FS,
                                             //          8=WO, 9=Plt Off, 10=Fg Off, 11=Flt Lt, 12=Sqn Ldr,
                                             //          13=Wg Cdr, 14=Gp Capt, 15=Air Cdre, 16=AVM,
                                             //          17=Air Mshl, 18=ACM, 19=MRAF.
    }
  ],
  "props": [
    {
      "id": "p1",
      "type": "laptop",                      // one of: ${[...PROP_TYPES].join(', ')}
      "label": "AI"                          // optional, <= 16 chars
    }
  ],
  "beats": [
    {
      "id": "b1",
      "textSpan": { "start": 0, "end": 38 }, // char offsets into the section body — beats together must cover the body in order
      "durationMs": 2500,                    // 1500 to 5000
      "actions": [
        { "type": "enter",     "actorId": "a1", "params": { "position": "centre" } },
        { "type": "salute",    "actorId": "a1" },
        { "type": "show-name", "actorId": "a1" }
      ]
    }
  ]
}

Action params:
- enter:       params.position = 'left' | 'centre' | 'right'  (default 'centre')
- walk-to:     params.position = 'left' | 'centre' | 'right'
- speak:       params.text     = string <= 60 chars (short, punchy — what the actor says in this beat). Cleared at the next beat.
- point:       params.targetId = id of an actor or prop
- argue:       params.targetActorId = id of another actor
- throw-up:    params.propId   = id of a prop the actor is holding
- pilot:       params.propId   = id of an aircraft/helicopter prop. ONLY use this when the section text explicitly states a named person/role flies, pilots, intercepts, scrambles, sorties, or operates the aircraft in question. Do NOT use 'pilot' (or even include an aircraft prop) just because the brief mentions aviation in general, an aircraft is named in passing, or you need a "punchy" closing visual. When in doubt, omit the aircraft — stickmen + ticker facts carry the meaning without random airframes appearing.
- show-text:   params.text     = string <= 80 chars. CALLOUT — slides in big and centred, holds for a beat, slides out. Use a complete, self-contained PHRASE that means something on its own (e.g. "AI-enabled air force planned for 2030s"), NOT a one-word keyword. Think of it as a TV-cartoon caption: it appears, lands, and exits — it does NOT stick around.
- show-stat:   params.value (<=10 chars, e.g. "12%", "£4.5B", "1,200"), params.label (<=40 chars caption, e.g. "YoY RAF recruitment increase"). CALLOUT — big number with descriptive caption, same slide-in / slide-out behaviour. Use for any numeric fact. The caption must give enough context that the value is meaningful in isolation.
- show-date:   params.date (<=14 chars, e.g. "Mar 2026", "Q3 2025", "1982"), params.label optional (<=40 chars caption, e.g. "AI ops originally planned"). CALLOUT — date stamp with optional caption.
- crossout:    no params. Swipes a big red X over the callout that's currently on screen. Use it AFTER a show-text / show-stat / show-date in the SAME beat when the section text frames that fact as superseded, abandoned, revised, or "originally planned". The viewer sees the old fact appear, reads it, then watches it get violently cancelled — far stickier than just stating the new fact alone.
- flyby:       optional params.aircraft = an array of EXACTLY two slugs picked from {typhoon, f35, hawk, a400m, c17, chinook, wedgetail, poseidon}. If omitted (preferred), the renderer picks two random airframes from the same set. Renders a brief 3D flyby across the stage using the real RAF GLB models the app already ships. Use 'flyby' for ambient aircraft references in the source text (drones, fighter jets, uncrewed aircraft, "the F-35 fleet", "RAF jets patrolled") where there is NO specific named individual operating the aircraft. Reserve 'pilot' for the case where a named timeline actor is explicitly depicted in the cockpit.
- pulse:       params.targetId = id of an actor or prop to flash
- background:  params.propId   = id of a sky-bg or map prop

Rules:
1. The "raf-primary" colour is reserved for the single most important RAF/UK MoD individual being profiled or quoted. Use "raf-secondary" for any other RAF figures.
2. Allied non-RAF figures (e.g. US generals, NATO commanders) use "ally". Civilian/political/journalist figures use "civilian". Opposing-force figures use "adversary" sparingly — never with identifying detail beyond a stickman.
3. textSpan ranges must reference real character offsets inside the provided section body. Beats should cover the body in reading order with no large gaps.
4. Keep totalDurationMs between 10000 and 26000 — give viewers time to read the facts you add to the ticker. Each beat should hold 2500–5000ms.
5. THE PRIMARY GOAL IS INFORMATION RETENTION. Every numeric fact in the section MUST become a show-stat. Every specific date or year MUST become a show-date. Every important named concept (squadron name, unit, treaty, operation, place, decision) should become a show-text. Spectacle (salute, argue, pilot, throw-up) is decoration only — it should never replace a fact.
6. CALLOUTS ARE TV-STYLE — they appear ONE AT A TIME, dominate the screen briefly, then dismiss. Do not put more than ONE callout (show-text / show-stat / show-date) in a single beat. If a beat needs multiple facts, split it into separate beats so each callout gets its own moment. The viewer cannot read two callouts at once.
7. CALLOUT TEXT MUST STAND ALONE. A callout the viewer sees out of context should still make sense — "AI air force" is too short, "AI-enabled air force originally planned for 2030s" is right. For stats: "+12%" without a label is meaningless, "+12%" with label "YoY RAF recruitment" is the right shape.
8. Within a beat, prefer 2–4 actions: at most ONE callout, plus one or two character actions (enter / pilot / point / pulse), and optionally a speak. Avoid stuffing 5+ actions into one beat.
9. RANK: whenever an RAF actor's TITLE is given in the source text (e.g. "Air Chief Marshal", "Wing Commander", "Sergeant"), set their numeric \`rank\` field using the mapping above. This drives the visible insignia on the hat — leaving it off means no insignia is drawn. Civilian/ally/adversary actors must NOT have a rank. If an RAF actor has no title in the source text (e.g. "a Typhoon pilot"), choose a sensible rank from the role: 11 (Flt Lt) for typical pilots, 14 (Gp Capt) for senior commanders, 12 (Sqn Ldr) for squadron leadership, 5 (Sgt) for ground-crew NCOs.
10. Use show-name on the first beat that mentions an actor by full name. Do not repeat show-name for the same actor.
11. If the section discusses an event with no clear named individual, use a single "raf-secondary" generic stickman labelled by role (e.g. shortLabel: "RAF Pilot"). Do not invent names.
12. Aircraft props are drawn in brand-blue when their context is RAF; if a section explicitly discusses a foreign airframe, use "aircraft-generic". Never invent enemy faction markings.
13. AIRCRAFT JUSTIFICATION: include an aircraft prop only when the section text gives at least ONE of: (a) a named aircraft/airframe ("Typhoon", "F-35", "Tu-95"), (b) a flight verb ("intercept", "scramble", "sortie", "fly", "pilot", "deploy aircraft"), (c) a flight squadron actively conducting an operation. If none of those appear in the section, do NOT add any aircraft prop and do NOT use 'pilot' — leaving the actor on the ground with their facts is strictly better than tagging on a random airframe. When you DO add an aircraft, always also add a 'show-text' or include the airframe name in the prop.label so the viewer can identify it.
14. CROSSOUT for SUPERSEDED facts: whenever the section text frames a date, plan, target, or stat as the OLD / ORIGINAL / SUPERSEDED one — phrases like "originally planned for", "the prior target of", "the abandoned X programme", "down from", "previously expected", "envisaged for" — emit a show-date / show-text / show-stat for the OLD value, then a 'crossout' action in the SAME beat. Concrete examples that should trigger this: "originally envisaged for the 2030s" → show-date "2030s" + crossout; "the original 12% target" → show-stat "12%" + crossout; "the cancelled Tempest programme" → show-text "Tempest programme" + crossout. The NEXT beat should show the replacement/current fact uncrossed so the viewer leaves with the correct information cemented. Bias toward USING crossout whenever the source text contrasts an old fact with a new one — it is a more durable memory anchor than narration alone.
15. FLYBY for AMBIENT aircraft mentions: when the section text references aircraft activity in aggregate or abstract — phrases like "uncrewed aircraft", "drone fleet", "fighter jets", "robot jets", "the F-35 force", "RAF jets patrolled", "autonomous aircraft" — emit a 'flyby' action in that beat. This is DIFFERENT from rule 13's 'pilot' action: 'pilot' requires a named timeline actor depicted operating a SPECIFIC airframe; 'flyby' is for the ambient case where no individual is in the cockpit but the text wants the viewer to picture aircraft. The flyby is non-blocking — it can coexist with a show-text or show-stat in the same beat. If the text names a specific airframe ("F-35", "Typhoon"), pass it via params.aircraft = ["f35", "typhoon"]; otherwise omit params and the renderer picks at random.
16. Output ONLY the JSON object. No markdown, no code fences, no commentary.`;

const WORKED_EXAMPLES = `Examples of well-formed reels.

--- Example A (one callout per beat, each phrased to stand alone) ---
Section body:
"Air Chief Marshal Harvey Smyth has stated that the Royal Air Force must accelerate its shift towards an AI-enabled air force, originally envisaged for the 2030s. He now argues that rapid advances in artificial intelligence and autonomous systems mean that AI-powered uncrewed aircraft must become operational much sooner than previously planned."

Output:
{"version":1,"totalDurationMs":22000,"actors":[{"id":"smyth","name":"Air Chief Marshal Harvey Smyth","shortLabel":"ACM Smyth","faction":"raf-primary","headgear":"cap-acm","rank":18}],"props":[],"beats":[{"id":"b1","textSpan":{"start":0,"end":36},"durationMs":3500,"actions":[{"type":"enter","actorId":"smyth","params":{"position":"centre"}},{"type":"show-name","actorId":"smyth"},{"type":"salute","actorId":"smyth"}]},{"id":"b2","textSpan":{"start":37,"end":135},"durationMs":4500,"actions":[{"type":"show-text","params":{"text":"RAF must accelerate towards AI-enabled air force"}}]},{"id":"b3","textSpan":{"start":136,"end":167},"durationMs":4500,"actions":[{"type":"show-date","params":{"date":"2030s","label":"original plan, now too slow"}},{"type":"crossout"}]},{"id":"b4","textSpan":{"start":168,"end":260},"durationMs":4500,"actions":[{"type":"show-text","params":{"text":"AI + autonomous systems mean uncrewed aircraft are ready earlier"}},{"type":"flyby"}]},{"id":"b5","textSpan":{"start":261,"end":380},"durationMs":5000,"actions":[{"type":"speak","actorId":"smyth","params":{"text":"Operational sooner than planned."}},{"type":"show-stat","params":{"value":"Sooner","label":"than the 2030s timeline"}}]}]}

--- Example B (numbered facts + a justified aircraft because the text says someone flies it) ---
Section body:
"RAF Typhoons of 6 Squadron, based at RAF Lossiemouth, intercepted two Russian Tu-95 Bear bombers approaching UK airspace north of Scotland. The aircraft were escorted away from the UK air policing area without incident."

Output:
{"version":1,"totalDurationMs":18000,"actors":[{"id":"pilot","name":"RAF Typhoon Pilot","shortLabel":"6 Sqn Pilot","faction":"raf-primary","headgear":"flight-helmet","rank":11}],"props":[{"id":"typhoon","type":"aircraft-typhoon","label":"Typhoon FGR4"},{"id":"sky","type":"sky-bg"}],"beats":[{"id":"b1","textSpan":{"start":0,"end":56},"durationMs":4000,"actions":[{"type":"background","params":{"propId":"sky"}},{"type":"enter","actorId":"pilot","params":{"position":"centre"}},{"type":"show-text","params":{"text":"6 Squadron, RAF Lossiemouth"}}]},{"id":"b2","textSpan":{"start":57,"end":120},"durationMs":4500,"actions":[{"type":"pilot","actorId":"pilot","params":{"propId":"typhoon"}},{"type":"show-stat","params":{"value":"2","label":"Russian Tu-95 Bear bombers intercepted"}}]},{"id":"b3","textSpan":{"start":121,"end":175},"durationMs":4500,"actions":[{"type":"show-text","params":{"text":"Approaching UK airspace north of Scotland"}}]},{"id":"b4","textSpan":{"start":176,"end":250},"durationMs":5000,"actions":[{"type":"speak","actorId":"pilot","params":{"text":"Escorted clear of UK air policing area."}}]}]}

--- Example C (numeric heavy — each stat in its own beat, no aircraft because nobody flies one) ---
Section body:
"RAF recruitment rose 12% year-on-year as the new fast-jet pipeline cleared its longstanding backlog. Recruit numbers at RAF Cranwell reached a five-year high and entry into training is now within twelve weeks of application."

Output:
{"version":1,"totalDurationMs":18000,"actors":[{"id":"lead","name":"RAF Recruitment Lead","shortLabel":"Recruiter","faction":"raf-primary","headgear":"cap-officer","rank":14}],"props":[],"beats":[{"id":"b1","textSpan":{"start":0,"end":50},"durationMs":4000,"actions":[{"type":"enter","actorId":"lead","params":{"position":"centre"}},{"type":"show-name","actorId":"lead"},{"type":"show-stat","params":{"value":"+12%","label":"YoY RAF recruitment rise"}}]},{"id":"b2","textSpan":{"start":51,"end":100},"durationMs":4500,"actions":[{"type":"show-text","params":{"text":"Fast-jet pipeline backlog cleared"}}]},{"id":"b3","textSpan":{"start":101,"end":175},"durationMs":4500,"actions":[{"type":"show-stat","params":{"value":"5-yr","label":"recruit high at RAF Cranwell"}},{"type":"pulse","actorId":"lead","params":{"targetId":"lead"}}]},{"id":"b4","textSpan":{"start":176,"end":230},"durationMs":5000,"actions":[{"type":"show-stat","params":{"value":"12 wk","label":"from application to training start"}},{"type":"speak","actorId":"lead","params":{"text":"Twelve weeks to start."}}]}]}`;

const SYSTEM_PROMPT = `You are the Brief Reel script writer for SkyWatch — a Royal Air Force training platform. Your job is to translate one section of an intel brief into a punchy, faithful stickman animation timeline that helps the reader visualise and remember the key facts.

${SCHEMA_DOC}

${WORKED_EXAMPLES}`;

// ── Validation ──────────────────────────────────────────────────────────────

function isIntInRange(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

function validateTimeline(timeline, bodyLen) {
  if (!timeline || typeof timeline !== 'object') return 'timeline must be an object';
  if (timeline.version !== 1)                    return 'version must be 1';
  if (!Array.isArray(timeline.actors))           return 'actors must be an array';
  if (!Array.isArray(timeline.props))            return 'props must be an array';
  if (!Array.isArray(timeline.beats))            return 'beats must be an array';
  if (timeline.beats.length === 0)               return 'beats must not be empty';
  if (!isIntInRange(timeline.totalDurationMs, 4000, 40000)) return 'totalDurationMs out of range';

  const actorIds = new Set();
  for (const a of timeline.actors) {
    if (!a || typeof a.id !== 'string' || actorIds.has(a.id)) return `bad actor id: ${a?.id}`;
    if (typeof a.name !== 'string' || !a.name.trim())          return `actor ${a.id} missing name`;
    if (!FACTIONS.has(a.faction))                              return `actor ${a.id} bad faction: ${a.faction}`;
    if (!HEADGEAR.has(a.headgear))                             return `actor ${a.id} bad headgear: ${a.headgear}`;
    if (a.rank != null && !isIntInRange(a.rank, 1, 19))        return `actor ${a.id} bad rank: ${a.rank}`;
    actorIds.add(a.id);
  }

  const propIds = new Set();
  for (const p of timeline.props) {
    if (!p || typeof p.id !== 'string' || propIds.has(p.id)) return `bad prop id: ${p?.id}`;
    if (!PROP_TYPES.has(p.type))                              return `prop ${p.id} bad type: ${p.type}`;
    propIds.add(p.id);
  }

  let sumMs = 0;
  for (const b of timeline.beats) {
    if (!b || typeof b.id !== 'string')                                  return `bad beat id: ${b?.id}`;
    if (!isIntInRange(b.durationMs, 800, 10000))                         return `beat ${b.id} bad durationMs`;
    sumMs += b.durationMs;
    const ts = b.textSpan;
    if (!ts || !isIntInRange(ts.start, 0, bodyLen) || !isIntInRange(ts.end, 0, bodyLen) || ts.end < ts.start) {
      return `beat ${b.id} bad textSpan`;
    }
    if (!Array.isArray(b.actions) || b.actions.length === 0)             return `beat ${b.id} has no actions`;
    for (const act of b.actions) {
      if (!ACTION_TYPES.has(act.type))                                   return `beat ${b.id} bad action: ${act.type}`;
      if (act.actorId && !actorIds.has(act.actorId))                     return `beat ${b.id} action references unknown actor ${act.actorId}`;
      const tid = act.params?.targetId || act.params?.propId || act.params?.targetActorId;
      if (tid && !actorIds.has(tid) && !propIds.has(tid))                return `beat ${b.id} action references unknown id ${tid}`;
    }
  }

  // Total duration sanity — accept ±25% drift from the declared total.
  if (sumMs < timeline.totalDurationMs * 0.75 || sumMs > timeline.totalDurationMs * 1.25) {
    return `beat durations (${sumMs}ms) drift too far from totalDurationMs (${timeline.totalDurationMs}ms)`;
  }

  return null; // OK
}

// ── Public API ──────────────────────────────────────────────────────────────

async function generateBriefReelTimeline({ briefTitle, sectionHeading, sectionBody }) {
  if (typeof sectionBody !== 'string' || sectionBody.trim().length < 20) {
    throw new Error('sectionBody too short to animate');
  }

  const userMsg = `Brief title: ${briefTitle || '(untitled)'}
Section heading: ${sectionHeading || '(no heading)'}
Section body (${sectionBody.length} chars):
"""
${sectionBody}
"""

Return ONLY the JSON timeline.`;

  const aiRes = await callOpenRouter({
    key:     'briefreel',
    feature: 'brief-reel',
    body: {
      model: 'anthropic/claude-sonnet-4-5',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2500,
      temperature: 0.4,
    },
  });

  const raw = aiRes?.choices?.[0]?.message?.content ?? '{}';
  const parsed = parseTimelineJson(raw);
  if (!parsed) {
    console.error('[BriefReel] non-JSON timeline. Raw response:\n' + String(raw).slice(0, 800));
    throw new Error('AI returned non-JSON timeline');
  }

  const err = validateTimeline(parsed, sectionBody.length);
  if (err) {
    console.error('[BriefReel] invalid timeline (' + err + '). Raw response:\n' + String(raw).slice(0, 800));
    throw new Error(`Invalid timeline: ${err}`);
  }

  // After validation, scale each beat's durationMs up to match its readable
  // payload — the AI tends to pick durations that leave a 60-char callout
  // on screen for only ~2s, which is too fast to read. We never shorten a
  // beat the AI picked, only stretch where the content demands more time.
  adjustBeatDurations(parsed);

  return parsed;
}

// Minimum dwell time for a readable payload, based on a slow reading speed
// of ~18 chars/sec for headline-style text. Includes a lead-in for the
// gesture phase that fires before the headline lands.
const PRE_HEADLINE_LEAD_MS = 1100;
const MS_PER_CHAR          = 55;
const MAX_BEAT_MS          = 10000; // matches validateTimeline's range cap
const MAX_TOTAL_MS         = 40000;

function readablePayload(action) {
  const p = action.params || {};
  switch (action.type) {
    case 'show-text': return String(p.text  || '');
    case 'show-stat': return String(p.value || '') + ' ' + String(p.label || '');
    case 'show-date': return String(p.date  || '') + ' ' + String(p.label || '');
    case 'speak':     return String(p.text  || '');
    default: return '';
  }
}

function adjustBeatDurations(timeline) {
  for (const beat of timeline.beats) {
    let longestPayload = 0;
    for (const action of beat.actions || []) {
      const payload = readablePayload(action).trim();
      if (payload.length > longestPayload) longestPayload = payload.length;
    }
    if (longestPayload === 0) continue;

    const needed = PRE_HEADLINE_LEAD_MS + longestPayload * MS_PER_CHAR;
    if (needed > beat.durationMs) {
      beat.durationMs = Math.min(needed, MAX_BEAT_MS);
    }
  }
  // Re-sync the declared total so the player's safe-range checks still pass.
  const sum = timeline.beats.reduce((s, b) => s + b.durationMs, 0);
  timeline.totalDurationMs = Math.min(sum, MAX_TOTAL_MS);
}

// Robust JSON extractor — handles the three common Anthropic-via-OpenRouter
// shapes despite the response_format hint:
//   1) Pure JSON              → parse directly
//   2) ```json … ``` fenced   → strip the fence
//   3) Prose preamble + JSON  → find the outermost {…} block by brace balance
// Returns the parsed object or null if no valid JSON object can be extracted.
function parseTimelineJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  // Strip a leading/trailing markdown code fence if present.
  let s = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();

  // Fast path: response IS the JSON.
  try { return JSON.parse(s); } catch { /* fall through */ }

  // Slow path: scan for the outermost balanced { … } object.
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"')  { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{')  depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}

module.exports = {
  generateBriefReelTimeline,
  validateTimeline,
  parseTimelineJson,
  adjustBeatDurations,
  FACTIONS,
  HEADGEAR,
  PROP_TYPES,
  ACTION_TYPES,
};
