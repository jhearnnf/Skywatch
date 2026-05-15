import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { lazy, Suspense as ReactSuspense } from 'react';
import Stickman      from './primitives/Stickman';
// 3D actor renderer is lazy-loaded so the R3F + drei + three.js bundle is
// only paid for by users who actually toggle the prototype flag.
const Stage3DOverlay = lazy(() => import('./Stage3DOverlay'));
// Flyby overlay is also lazy-loaded — most beats don't fire a flyby, so
// pulling in three.js + drei + the aircraft GLB cache only when needed
// keeps the brief reader's initial load lean.
const FlybyOverlay   = lazy(() => import('./FlybyOverlay'));

// AI hands us a small enum of aircraft slugs; the renderer resolves each to
// a GLB path the way Vite expects it (with the URL-encoded spaces). The
// slug set must stay in sync with the schema doc in briefReelAi.js.
const FLYBY_AIRCRAFT_BY_SLUG = {
  typhoon:   '/models/eurofighter typhoon fgr4.glb',
  f35:       '/models/f-35b lightning ii.glb',
  hawk:      '/models/hawk t2.glb',
  a400m:     '/models/a400m atlas c1.glb',
  c17:       '/models/c-17a globemaster iii.glb',
  chinook:   '/models/chinook hc6 6a.glb',
  wedgetail: '/models/e-7a wedgetail.glb',
  poseidon:  '/models/p-8a poseidon mra1.glb',
};
const FLYBY_SLUGS = Object.keys(FLYBY_AIRCRAFT_BY_SLUG);

function resolveFlybyAircraft(params) {
  // If the AI specified two valid slugs, honour them. Otherwise pick two
  // distinct aircraft at random so every flyby has visual variety even when
  // the source text doesn't name an airframe.
  const requested = Array.isArray(params?.aircraft) ? params.aircraft : null;
  const valid = requested
    ? requested.filter(s => FLYBY_AIRCRAFT_BY_SLUG[s]).slice(0, 2)
    : null;
  if (valid && valid.length === 2 && valid[0] !== valid[1]) {
    return valid.map(s => FLYBY_AIRCRAFT_BY_SLUG[s]);
  }
  const shuffled = [...FLYBY_SLUGS].sort(() => Math.random() - 0.5);
  return [FLYBY_AIRCRAFT_BY_SLUG[shuffled[0]], FLYBY_AIRCRAFT_BY_SLUG[shuffled[1]]];
}
import Prop          from './primitives/Prop';
import SpeechBubble  from './primitives/SpeechBubble';
import TextLabel     from './primitives/TextLabel';
import {
  STAGE_BG, STAGE_GRID, SKY_GRADIENT_TOP, SKY_GRADIENT_BOTTOM,
} from './colors';

// The player owns the SCENE. Facts (show-text / show-stat / show-date) now
// render as TRANSIENT centre-stage callouts — one at a time, slide in big,
// hold for the action's time slice, slide out. No competing side panels.
// At the end of the reel, every callout shown is replayed together as a
// "Recap" view for ~4s before onComplete fires.
//
// Stage geometry — 16:9 viewBox. Actors stand on a ground line near the
// bottom; the upper canvas is reserved for the active speech bubble and
// (on mobile) the source-excerpt caption strip.

const VB_W = 1920;
const VB_H = 1080;
const GROUND_Y = 920;
const STICKMAN_LOCAL_H = 130;
const ACTOR_SCALE = 2.4;
const ACTOR_HEIGHT = STICKMAN_LOCAL_H * ACTOR_SCALE; // 312
const ACTOR_HALF_W = 40 * ACTOR_SCALE;               // 96

const POSITION_X = { left: 460, centre: 960, right: 1460 };
const POSITION_X_OFFSTAGE_LEFT  = -300;
const POSITION_X_OFFSTAGE_RIGHT = VB_W + 300;

const CAPTION_Y = 20;
const CAPTION_H = 110;
const CAPTION_PAD_X = 32;

// Action types that put the beat's main readable payload on screen — once
// fired they stay until the next beat clears them. We schedule the beat so
// the headline lands with at least HEADLINE_MIN_DWELL_MS of remaining beat
// time, and we give any pre-actions (entrances, salutes, show-name) a
// breathing-room slice of ≈ PRE_DWELL_MS each so the viewer sees the actor
// arrive, settle, and be named BEFORE the fact lands.
const HEADLINE_ACTIONS    = new Set(['show-text', 'show-stat', 'show-date', 'speak']);
const HEADLINE_MIN_DWELL_MS = 2500;
const PRE_DWELL_MS          = 900;

// Stable per-actor phase offset (in seconds) for the breathing CSS animation.
// Hashing the actor id keeps the same actor at the same point in the cycle
// across renders (no jitter) while making neighbouring actors out of sync.
// Animation duration is 4.8s in CSS; we spread offsets across that range.
const BREATH_CYCLE_S = 4.8;
function breathPhaseFor(id) {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * BREATH_CYCLE_S;
}

function positionToX(p) {
  if (p === 'offstage') return POSITION_X_OFFSTAGE_LEFT;
  return POSITION_X[p] ?? POSITION_X.centre;
}

// Display name for an aircraft prop. Falls back to prop.label (set by AI) if
// provided, then to a friendly type name. Returned uppercased for the
// mono-spaced badge under the piloted aircraft.
function aircraftLabelText(prop) {
  if (prop?.label) return String(prop.label).toUpperCase();
  switch (prop?.type) {
    case 'aircraft-typhoon': return 'TYPHOON';
    case 'aircraft-f35':     return 'F-35';
    case 'aircraft-generic': return 'AIRCRAFT';
    case 'helicopter':       return 'HELICOPTER';
    case 'drone-uav':        return 'UAV';
    case 'missile':          return 'MISSILE';
    default:                 return 'AIRCRAFT';
  }
}

// Each scene-affecting action mutates the world draft. Callouts (show-text /
// show-stat / show-date) replace draft.callout with a fresh entry; they
// auto-clear when the next callout appears or when the beat ends.
function applyAction(draft, action, ctx) {
  const { type, actorId, params = {} } = action;
  switch (type) {
    case 'enter':
    case 'walk-to': {
      const a = draft.actors[actorId];
      if (a) a.position = params.position || 'centre';
      break;
    }
    case 'exit': {
      const a = draft.actors[actorId];
      if (a) a.position = 'offstage';
      break;
    }
    case 'salute': {
      const a = draft.actors[actorId];
      if (a) { a.saluteCount = (a.saluteCount || 0) + 1; a.mode = 'saluting'; }
      break;
    }
    case 'argue': {
      const a = draft.actors[actorId];
      if (a) { a.mode = 'arguing'; a.argueWith = params.targetActorId; }
      const t = draft.actors[params.targetActorId];
      if (t) { t.mode = 'arguing'; t.argueWith = actorId; }
      break;
    }
    case 'speak': {
      const a = draft.actors[actorId];
      if (a) a.speech = params.text || '';
      break;
    }
    case 'show-name': {
      const a = draft.actors[actorId];
      if (a) a.nameShownAt = ctx.beatId;
      break;
    }
    case 'show-text': {
      if (params.text) {
        draft.callout = {
          id:    `${ctx.beatId}-${ctx.actionIdx}`,
          kind:  'text',
          text:  params.text,
        };
      }
      break;
    }
    case 'show-stat': {
      draft.callout = {
        id:    `${ctx.beatId}-${ctx.actionIdx}`,
        kind:  'stat',
        value: params.value || '',
        label: params.label || '',
      };
      break;
    }
    case 'show-date': {
      draft.callout = {
        id:    `${ctx.beatId}-${ctx.actionIdx}`,
        kind:  'date',
        value: params.date || '',
        label: params.label || '',
      };
      break;
    }
    case 'pulse': {
      let targetActorId = params.targetId;
      if (!draft.actors[targetActorId]) {
        const holder = Object.values(draft.actors).find(a => a.holding === params.targetId);
        if (holder) targetActorId = holder.id;
      }
      const target = draft.actors[targetActorId];
      if (target) target.pulseCount = (target.pulseCount || 0) + 1;
      break;
    }
    case 'background': {
      draft.background = params.propId;
      break;
    }
    case 'crossout': {
      // Mark the active callout as invalidated. The renderer draws a big
      // red X across the callout's bounding box; the X stays until the
      // next beat clears the callout entirely. A crossout fired with no
      // active callout is a no-op — the AI prompt forbids that but we
      // tolerate it rather than crashing.
      if (draft.callout) {
        draft.callout = { ...draft.callout, crossedOut: true };
      }
      break;
    }
    case 'flyby': {
      // Resolve which two aircraft GLBs are flying; cleared at the next
      // beat boundary. The id encodes the firing action so React remounts
      // the overlay (and re-starts the cross-screen animation) every time.
      draft.flyby = {
        id: `${ctx.beatId}-${ctx.actionIdx}`,
        aircraft: resolveFlybyAircraft(params),
      };
      break;
    }
    case 'pilot': {
      const a = draft.actors[actorId];
      if (a) { a.holding = params.propId; a.mode = 'piloting'; }
      break;
    }
    case 'throw-up': {
      const a = draft.actors[actorId];
      if (a) a.holding = null;
      break;
    }
    case 'point': {
      const a = draft.actors[actorId];
      if (a) a.pointingAt = params.targetId;
      break;
    }
    default:
      break;
  }
}

function makeInitialWorld(timeline) {
  const actors = {};
  for (const a of timeline.actors || []) {
    actors[a.id] = {
      ...a,
      position:   'offstage',
      mode:       'standing',
      saluteCount: 0,
      speech:     '',
      argueWith:  null,
      holding:    null,
      nameShownAt: null,  // beatId where show-name fired; cleared at next beat
      pointingAt: null,
      pulseCount: 0,
    };
  }
  const propRefs = {};
  for (const p of timeline.props || []) propRefs[p.id] = p;
  return { actors, propRefs, background: null, callout: null, flyby: null };
}

// At the start of each beat: clear short-lived per-beat state. Speech +
// transient modes don't carry across; the name label fades as a new beat
// starts unless that beat fires show-name again.
function clearBeatScoped(world, incomingBeatId) {
  for (const id of Object.keys(world.actors)) {
    const a = world.actors[id];
    a.speech = '';
    if (a.mode === 'saluting' || a.mode === 'arguing') a.mode = 'standing';
    a.argueWith  = null;
    a.pointingAt = null;
    if (a.nameShownAt && a.nameShownAt !== incomingBeatId) a.nameShownAt = null;
  }
  // Callout clears at beat start so a beat without a fresh callout returns
  // the stage to "just characters" rather than holding a stale fact.
  world.callout = null;
  // Flybys are one-shot — never persist past their beat. The next beat
  // will set this again if it wants planes on screen.
  world.flyby = null;
}

// Detect the 3D-prototype flag from the current URL. Reading once at module
// scope keeps the flag stable for the lifetime of the page — toggling
// requires a navigation. Accepts `?3d=1`, `?3d=true`, or the env variable
// `VITE_BRIEF_REEL_3D=1` so QA can build with it baked in.
function read3DFlag() {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('3d');
      if (v === '1' || v === 'true') return true;
    } catch { /* ignore */ }
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BRIEF_REEL_3D === '1') return true;
  return false;
}

export default function BriefReelPlayer({
  timeline,
  sectionBody = '',
  showCaption = false,
  onBeatStart,
  onComplete,
  autoPlay = true,
  startBeatIdx = 0,
  className,
  modelUrl = '/models/stickman.glb',
}) {
  const [use3D, setUse3D] = useState(() => read3DFlag());
  const [world, setWorld] = useState(() => makeInitialWorld(timeline));
  const [activeBeat, setActiveBeat] = useState(null);
  const [recap, setRecap] = useState(null); // null while playing, [callouts] when showing recap
  const [paused, setPaused] = useState(false);
  const cancelledRef = useRef(false);
  const calloutLogRef = useRef([]); // accumulates every callout shown during the run
  // Pause/resume scaffolding: the running scheduler captures Date.now() at
  // beat start so we can compute "elapsed when paused", cancel timers, then
  // on resume re-enter the same beat at the same offset and only re-schedule
  // actions that hadn't fired yet.
  const pausedRef          = useRef(false);
  const pausedElapsedRef   = useRef(0);
  const beatStartTimeRef   = useRef(0);
  const currentBeatIdxRef  = useRef(0);
  const schedulerRef       = useRef(null); // { runBeat, timers, schedule }

  useEffect(() => {
    cancelledRef.current = false;
    setActiveBeat(null);
    setRecap(null);
    calloutLogRef.current = [];

    // Helper: if an action introduces a callout, record it (deduped by
    // kind+content) so the end-of-reel recap can replay every fact shown.
    const recordCallout = (action) => {
      const p = action.params || {};
      let entry = null;
      if (action.type === 'show-text' && p.text)            entry = { kind: 'text', text: p.text };
      else if (action.type === 'show-stat')                 entry = { kind: 'stat', value: p.value || '', label: p.label || '' };
      else if (action.type === 'show-date' && p.date)       entry = { kind: 'date', value: p.date, label: p.label || '' };
      if (!entry) return;
      const dup = calloutLogRef.current.some(e =>
        e.kind === entry.kind &&
        e.text  === entry.text  &&
        e.value === entry.value &&
        e.label === entry.label
      );
      if (!dup) {
        entry.id = `recap-${calloutLogRef.current.length}`;
        calloutLogRef.current.push(entry);
      }
    };

    // Pre-roll: silently apply every action in beats [0..startBeatIdx-1] so
    // when we begin playing at startBeatIdx the world (actor positions, who
    // is piloting what, what's holding what) reflects the cumulative state
    // the viewer would have seen if they'd watched from the start. Beat-
    // scoped state (speech, transient modes, callouts) is wiped at each
    // beat boundary just like during live playback, so the seek-target
    // beat starts from a clean slate the same way it would naturally.
    let prerolledWorld = makeInitialWorld(timeline);
    const safeStart = Math.max(0, Math.min(startBeatIdx, timeline.beats.length));
    for (let b = 0; b < safeStart; b++) {
      const beat = timeline.beats[b];
      const next = structuredClone(prerolledWorld);
      clearBeatScoped(next, beat.id);
      const actions = beat.actions || [];
      for (let i = 0; i < actions.length; i++) {
        recordCallout(actions[i]);
        applyAction(next, actions[i], { beatId: beat.id, actionIdx: i });
      }
      prerolledWorld = next;
    }
    setWorld(prerolledWorld);

    if (!autoPlay) return;

    const timers = new Set();
    const schedule = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
      return t;
    };

    // runBeat(beatIdx, skipMs=0): start (or resume) the given beat.
    //   - skipMs=0  → fresh beat: fire onBeatStart, run clearBeatScoped, apply
    //                 all t≤0 actions in a single setWorld, schedule the rest.
    //   - skipMs>0  → resume after pause: skip onBeatStart and clearBeatScoped
    //                 (state is already correct), only schedule actions whose
    //                 fireAt is still in the future, and auto-advance after
    //                 (durationMs - skipMs).
    const runBeat = (beatIdx, skipMs = 0) => {
      if (cancelledRef.current) return;
      if (beatIdx >= timeline.beats.length) {
        // Reel done — show the recap and stop. The recap stays on screen
        // until the user dismisses (swipe to next section, close button,
        // or re-click the reel button). We do NOT auto-fire onComplete —
        // the parent collapses the player from user action, not a timer.
        setActiveBeat(null);
        setRecap(calloutLogRef.current.slice());
        return;
      }
      const beat = timeline.beats[beatIdx];
      currentBeatIdxRef.current = beatIdx;
      beatStartTimeRef.current  = Date.now() - skipMs;
      if (skipMs === 0) {
        setActiveBeat(beat);
        onBeatStart?.(beat);
      }

      const actions = beat.actions || [];
      // Build a fire-time plan that respects the AI's action ordering while
      // giving each phase room to breathe:
      //   1. Pre-actions (anything before the headline) get ≈PRE_DWELL_MS each
      //      — actor enters, settles, name appears, then the fact lands.
      //   2. The headline (the first show-text/show-stat/show-date/speak)
      //      fires once pre-actions are done, BUT no later than
      //      durationMs - HEADLINE_MIN_DWELL_MS so the viewer has time to
      //      actually read it.
      //   3. Post-actions (any gestures after the headline) stagger across
      //      the remaining time. They don't replace the headline visually
      //      (callout/speech persist until beat end) — they just punctuate.
      const headlineIdx = actions.findIndex(a => HEADLINE_ACTIONS.has(a.type));
      const plan = [];
      if (headlineIdx === -1) {
        // Pure-gesture beat — stagger evenly.
        const stepMs = beat.durationMs / Math.max(1, actions.length);
        actions.forEach((a, i) => plan.push({ action: a, idx: i, fireAt: i * stepMs }));
      } else {
        const pre  = actions.slice(0, headlineIdx);
        const post = actions.slice(headlineIdx + 1);
        const wantedLead = pre.length * PRE_DWELL_MS;
        const maxLead    = Math.max(0, beat.durationMs - HEADLINE_MIN_DWELL_MS);
        const headlineAt = Math.min(wantedLead, maxLead);

        if (pre.length > 0) {
          const stepMs = headlineAt / pre.length;
          pre.forEach((a, k) => plan.push({ action: a, idx: k, fireAt: k * stepMs }));
        }
        plan.push({ action: actions[headlineIdx], idx: headlineIdx, fireAt: headlineAt });

        if (post.length > 0) {
          const remaining = beat.durationMs - headlineAt;
          const stepMs    = remaining / (post.length + 1);
          post.forEach((a, k) =>
            plan.push({ action: a, idx: headlineIdx + 1 + k, fireAt: headlineAt + (k + 1) * stepMs }));
        }
      }

      // On a fresh beat, fire everything scheduled at t=0 inside the initial
      // setWorld so the beat starts in one render rather than a flash of
      // empty stage. On resume (skipMs > 0), the world is already in the
      // correct state — don't re-fire already-fired actions.
      if (skipMs === 0) {
        const at0 = plan.filter(p => p.fireAt <= 0);
        setWorld(prev => {
          const next = structuredClone(prev);
          clearBeatScoped(next, beat.id);
          for (const { action, idx } of at0) {
            recordCallout(action);
            applyAction(next, action, { beatId: beat.id, actionIdx: idx });
          }
          return next;
        });
      }

      const later = plan.filter(p => p.fireAt > skipMs);
      for (const { action, idx, fireAt } of later) {
        schedule(() => {
          if (cancelledRef.current || pausedRef.current) return;
          recordCallout(action);
          setWorld(prev => {
            const next = structuredClone(prev);
            applyAction(next, action, { beatId: beat.id, actionIdx: idx });
            return next;
          });
        }, fireAt - skipMs);
      }

      schedule(() => runBeat(beatIdx + 1), beat.durationMs - skipMs);
    };

    schedulerRef.current = { runBeat, timers };
    runBeat(safeStart);

    return () => {
      cancelledRef.current = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      schedulerRef.current = null;
      pausedRef.current = false;
      setPaused(false);
    };
  }, [timeline, autoPlay, startBeatIdx, onBeatStart, onComplete]);

  const togglePause = useCallback(() => {
    const sched = schedulerRef.current;
    if (!sched) return; // recap / autoPlay=false
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      const elapsed = pausedElapsedRef.current;
      sched.runBeat(currentBeatIdxRef.current, elapsed);
    } else {
      const elapsed = Math.max(0, Date.now() - beatStartTimeRef.current);
      pausedElapsedRef.current = elapsed;
      pausedRef.current = true;
      setPaused(true);
      for (const t of sched.timers) clearTimeout(t);
      sched.timers.clear();
    }
  }, []);

  const bgProp = world.background ? world.propRefs[world.background] : null;
  const bgIsSky = bgProp?.type === 'sky-bg';
  const bgIsMap = bgProp?.type === 'map';

  // Establish "active speaker" — used to dim non-speakers so the eye lands
  // on whoever is currently talking.
  const activeSpeakerId = useMemo(() => {
    const speaker = Object.values(world.actors).find(a => a.speech);
    return speaker?.id ?? null;
  }, [world.actors]);

  // When a callout is on screen, the speech BUBBLE above the actor is
  // suppressed (it would overlap the callout). To avoid losing the actor's
  // quote entirely, fall through to a bottom-of-stage subtitle strip that
  // attributes the line to the speaker. Bottom strip + top callout share
  // the canvas without colliding.
  const subtitle = useMemo(() => {
    if (!world.callout || !activeSpeakerId) return null;
    const speaker = world.actors[activeSpeakerId];
    if (!speaker?.speech) return null;
    return { text: speaker.speech, attribution: speaker.shortLabel || speaker.name };
  }, [world.callout, world.actors, activeSpeakerId]);

  const actorList = useMemo(() => {
    const order = { 'adversary': 0, 'civilian': 1, 'ally': 2, 'raf-secondary': 3, 'raf-primary': 4 };
    return Object.values(world.actors).sort((a, b) => (order[a.faction] ?? 1) - (order[b.faction] ?? 1));
  }, [world.actors]);

  // Count actors actually on stage right now. Used to tighten speech-bubble
  // widths so two neighbouring stickmen don't have their bubbles overlap
  // each other in the upper half of the canvas.
  const onstageCount = useMemo(
    () => actorList.filter(a => a.position && a.position !== 'offstage').length,
    [actorList],
  );

  const captionText = useMemo(() => {
    if (!activeBeat || !sectionBody) return '';
    const { start = 0, end = 0 } = activeBeat.textSpan || {};
    return sectionBody.slice(start, end).trim();
  }, [activeBeat, sectionBody]);

  return (
    <div
      className={className}
      data-active-beat={activeBeat?.id ?? ''}
      data-paused={paused ? 'true' : undefined}
      data-renderer={use3D ? '3d' : 'svg'}
      style={{ position: 'relative' }}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="100%"
        style={{ display: 'block', background: STAGE_BG, borderRadius: 12, cursor: recap ? 'default' : 'pointer' }}
        role="img"
        aria-label={paused ? 'Brief Reel paused — tap to resume' : 'Brief Reel — tap to pause'}
        onClick={() => { if (!recap) togglePause(); }}
      >
        <defs>
          <linearGradient id="sky-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={SKY_GRADIENT_TOP} />
            <stop offset="100%" stopColor={SKY_GRADIENT_BOTTOM} />
          </linearGradient>
          <pattern id="map-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(91,170,255,0.18)" strokeWidth="1" />
          </pattern>
        </defs>

        <AnimatePresence>
          {bgIsSky && (
            <motion.rect key="bg-sky" x={0} y={0} width={VB_W} height={VB_H}
              fill="url(#sky-gradient)"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }} />
          )}
          {bgIsMap && (
            <motion.g key="bg-map"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}>
              <rect x={0} y={0} width={VB_W} height={VB_H} fill="#0a1f3a" />
              <rect x={0} y={0} width={VB_W} height={VB_H} fill="url(#map-grid)" />
              {bgProp?.label && (
                <text x={VB_W - 40} y={70} textAnchor="end"
                      fill="#5baaff" fontSize={36} fontWeight={700}
                      fontFamily="'JetBrains Mono',monospace"
                      style={{ letterSpacing: '0.18em' }}>
                  {bgProp.label.toUpperCase()}
                </text>
              )}
            </motion.g>
          )}
        </AnimatePresence>

        {!bgIsSky && !bgIsMap && (
          <>
            <rect x={0} y={0} width={VB_W} height={VB_H} fill={STAGE_BG} />
            <rect x={0} y={0} width={VB_W} height={VB_H} fill="url(#map-grid)" opacity={0.35} />
          </>
        )}
        <line x1={0} y1={GROUND_Y} x2={VB_W} y2={GROUND_Y} stroke={STAGE_GRID} strokeWidth={2} />

        {/* On mobile the source-excerpt caption rides the top of the stage —
            but the callout owns that same band when it's on screen. Pause
            the caption strip during callouts so the user isn't trying to
            read two things at once in the upper third. */}
        {showCaption && !world.callout && <CaptionStrip text={captionText} />}

        {actorList.map(actor => (
          <ActorOnStage
            key={actor.id}
            actor={actor}
            propRefs={world.propRefs}
            activeBeatId={activeBeat?.id}
            isSpeaker={activeSpeakerId === actor.id}
            dimmed={(activeSpeakerId != null && activeSpeakerId !== actor.id) || !!world.callout}
            suppressSpeech={!!world.callout}
            crowded={onstageCount > 1}
            hideBody={use3D}
          />
        ))}

        {/* Transient centre-stage callout — TV-cartoon style: slides in,
            dominates the frame for a beat, slides out. Replaces the old
            persistent ticker — one focal point at a time. */}
        <AnimatePresence>
          {world.callout && !recap && (
            <Callout key={world.callout.id} data={world.callout} />
          )}
        </AnimatePresence>

        {/* Speech-as-subtitle: when a callout dominates the upper third, the
            speaker's quote moves to a bottom strip so neither is lost. */}
        <AnimatePresence>
          {subtitle && !recap && (
            <SubtitleStrip key={subtitle.text} text={subtitle.text} attribution={subtitle.attribution} />
          )}
        </AnimatePresence>

        {/* End-of-reel recap — every callout shown during the run, laid out
            together as a memory anchor. Holds for ~4s before onComplete. */}
        <AnimatePresence>
          {recap && <RecapView items={recap} />}
        </AnimatePresence>

        {/* Paused indicator — shown over the stage when the viewer has tapped
            to pause. The stage state freezes; tapping again resumes the beat
            from the same offset, so a viewer can pause to read a long
            callout without missing any actions that hadn't fired yet. */}
        <AnimatePresence>
          {paused && !recap && (
            <motion.g
              key="pause-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit   ={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              pointerEvents="none"
            >
              <rect x={0} y={0} width={VB_W} height={VB_H} fill="rgba(6,16,30,0.45)" />
              <g transform={`translate(${VB_W / 2}, ${VB_H / 2})`}>
                <circle cx={0} cy={0} r={110}
                        fill="rgba(12,24,41,0.92)" stroke="#5baaff" strokeWidth={5} />
                <rect x={-34} y={-46} width={22} height={92} rx={5} fill="#5baaff" />
                <rect x={12}  y={-46} width={22} height={92} rx={5} fill="#5baaff" />
              </g>
              <text x={VB_W / 2} y={VB_H / 2 + 180} textAnchor="middle"
                    fill="#5baaff" fontSize={22} fontWeight={800}
                    fontFamily="'JetBrains Mono',monospace"
                    style={{ letterSpacing: '0.32em' }}>
                PAUSED · TAP TO RESUME
              </text>
            </motion.g>
          )}
        </AnimatePresence>
      </svg>

      {/* 3D actor overlay — lazy-loaded; lives in absolute-positioned div
          OVER the SVG so 3D figures cover the (now-hidden) SVG stickman
          bodies. SVG keeps owning callouts/captions/recap/pause. If the
          GLB fails to load, ErrorCatcher in Stage3DOverlay flips us back
          to SVG so the user never sees a broken stage. */}
      {use3D && !recap && (
        <ReactSuspense fallback={null}>
          <Stage3DOverlay
            actors={actorList}
            modelUrl={modelUrl}
            onError={() => setUse3D(false)}
          />
        </ReactSuspense>
      )}

      {/* 3D aircraft flyby — fires once per 'flyby' action and rides on
          its own R3F Canvas separate from the actor overlay. The world's
          flyby field is cleared at the next beat boundary, which unmounts
          this and cancels any in-flight animation. Keying on flyby.id
          ensures back-to-back flybys (rare but possible) get a clean
          remount that restarts the cross-screen tween from t=0. */}
      {world.flyby && !recap && (
        <ReactSuspense fallback={null}>
          <FlybyOverlay
            key={world.flyby.id}
            aircraft={world.flyby.aircraft}
          />
        </ReactSuspense>
      )}
    </div>
  );
}

function Callout({ data }) {
  // Big centred badge: slides down from the top of the stage, holds, slides
  // up and out. Sized to dominate roughly the upper third of the canvas.
  const cx = VB_W / 2;
  const cy = 360; // upper third of the stage
  const stroke = data.kind === 'date' ? '#f5c542' : '#5baaff';
  const xOut = !!data.crossedOut;
  return (
    <motion.g
      initial={{ y: -240, opacity: 0, scale: 0.85 }}
      animate={{ y: 0,    opacity: 1, scale: 1 }}
      exit   ={{ y: -120, opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {data.kind === 'stat' && <StatCalloutContent cx={cx} cy={cy} value={data.value} label={data.label} stroke={stroke} crossedOut={xOut} />}
      {data.kind === 'date' && <DateCalloutContent cx={cx} cy={cy} value={data.value} label={data.label} stroke={stroke} crossedOut={xOut} />}
      {data.kind === 'text' && <TextCalloutContent cx={cx} cy={cy} text={data.text} stroke={stroke} crossedOut={xOut} />}
    </motion.g>
  );
}

// Big-red-X swipe across a callout's bounding box. Used to mark a fact as
// superseded — the AI fires a `crossout` action after a show-text/show-stat
// /show-date in the same beat. Two diagonals draw in sequence (top-left→
// bottom-right then top-right→bottom-left) so it reads as a violent
// double-swipe, not a polite strikethrough. Both lines extend past the
// rect edges by a few pixels for impact.
function CrossoutOverlay({ cx, cy, width, height }) {
  const padX = 26;
  const padY = 18;
  const x0 = cx - width / 2 - padX;
  const x1 = cx + width / 2 + padX;
  const y0 = cy - height / 2 - padY;
  const y1 = cy + height / 2 + padY;
  return (
    <g pointerEvents="none">
      <motion.line
        x1={x0} y1={y0} x2={x1} y2={y1}
        stroke="#ef4444" strokeWidth={14} strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0.85 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.32, ease: 'easeOut' }}
      />
      <motion.line
        x1={x1} y1={y0} x2={x0} y2={y1}
        stroke="#ef4444" strokeWidth={14} strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0.85 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.32, ease: 'easeOut', delay: 0.18 }}
      />
    </g>
  );
}

function StatCalloutContent({ cx, cy, value, label, stroke, crossedOut }) {
  const v = String(value || '');
  const l = String(label || '');
  // Width auto-scales with the longest of value (huge font) vs label (medium).
  const width  = Math.min(VB_W - 160, Math.max(640, Math.max(v.length * 100, l.length * 28) + 160));
  const height = 280;
  return (
    <g>
      <rect x={cx - width / 2} y={cy - height / 2}
            width={width} height={height} rx={28}
            fill="rgba(12,24,41,0.94)" stroke={stroke} strokeWidth={5} />
      <text x={cx} y={cy - 4} textAnchor="middle"
            fill={stroke} fontSize={150} fontWeight={900}
            fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace"
            style={{ letterSpacing: '-0.01em' }}>
        {v}
      </text>
      {l && (
        <text x={cx} y={cy + 100} textAnchor="middle"
              fill="#ddeaf8" fontSize={36} fontWeight={600}
              fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
              style={{ letterSpacing: '0.02em' }}>
          {l}
        </text>
      )}
      {crossedOut && <CrossoutOverlay cx={cx} cy={cy} width={width} height={height} />}
    </g>
  );
}

function DateCalloutContent({ cx, cy, value, label, stroke, crossedOut }) {
  const v = String(value || '');
  const l = String(label || '');
  const width  = Math.min(VB_W - 160, Math.max(520, Math.max(v.length * 70, l.length * 28) + 160));
  const height = l ? 250 : 180;
  return (
    <g>
      <rect x={cx - width / 2} y={cy - height / 2}
            width={width} height={height} rx={24}
            fill="rgba(12,24,41,0.94)" stroke={stroke} strokeWidth={5} />
      <text x={cx} y={cy - height / 2 + 48} textAnchor="middle"
            fill={stroke} fontSize={28} fontWeight={800}
            fontFamily="'JetBrains Mono',monospace"
            style={{ letterSpacing: '0.24em' }}>
        DATE
      </text>
      <text x={cx} y={cy + (l ? -10 : 38)} textAnchor="middle"
            fill="#ddeaf8" fontSize={l ? 92 : 110} fontWeight={800}
            fontFamily="'JetBrains Mono',monospace">
        {v}
      </text>
      {l && (
        <text x={cx} y={cy + 80} textAnchor="middle"
              fill="#ddeaf8" fontSize={30} fontWeight={500}
              fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
              style={{ letterSpacing: '0.02em' }}>
          {l}
        </text>
      )}
      {crossedOut && <CrossoutOverlay cx={cx} cy={cy} width={width} height={height} />}
    </g>
  );
}

function TextCalloutContent({ cx, cy, text, stroke, crossedOut }) {
  // Wrap long text into two lines if needed; pick the break near the middle.
  const lines = wrapTwoLines(text, 32);
  const fontSize = 52;
  const lineH = 64;
  const longest = lines.reduce((m, ln) => Math.max(m, ln.length), 0);
  const width  = Math.min(VB_W - 160, Math.max(640, longest * 30 + 160));
  const height = lines.length === 2 ? 220 : 160;
  return (
    <g>
      <rect x={cx - width / 2} y={cy - height / 2}
            width={width} height={height} rx={24}
            fill="rgba(12,24,41,0.94)" stroke={stroke} strokeWidth={5} />
      {lines.map((ln, i) => (
        <text key={i}
              x={cx}
              y={cy - ((lines.length - 1) * lineH) / 2 + i * lineH + fontSize / 3}
              textAnchor="middle"
              fill="#ddeaf8" fontSize={fontSize} fontWeight={700}
              fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
          {ln}
        </text>
      ))}
      {crossedOut && <CrossoutOverlay cx={cx} cy={cy} width={width} height={height} />}
    </g>
  );
}

function wrapTwoLines(text, softLimit) {
  if (!text) return [''];
  const s = String(text);
  if (s.length <= softLimit) return [s];
  const target = Math.floor(s.length / 2);
  // Prefer a space close to the midpoint
  let breakAt = -1;
  for (let off = 0; off < s.length / 2; off++) {
    const a = target + off, b = target - off;
    if (a < s.length && s[a] === ' ') { breakAt = a; break; }
    if (b > 0 && s[b] === ' ')        { breakAt = b; break; }
  }
  if (breakAt < 0) return [s.slice(0, target), s.slice(target)];
  return [s.slice(0, breakAt), s.slice(breakAt + 1)];
}

// ── Recap view ─────────────────────────────────────────────────────────────
// Held for ~4s after the final beat. Lays every callout from the run out
// together so the viewer's eye can land on each fact one more time before
// the reel closes.
function RecapView({ items }) {
  // Grid layout: cap at 2 columns so each cell stays large enough to read
  // even when a reel produced 5+ callouts. Cell height shrinks slightly
  // when there are 4+ rows so the full grid still fits the stage without
  // clipping under the recap header.
  const cols = items.length <= 1 ? 1 : 2;
  const rows = Math.ceil(items.length / cols);
  const cellW = Math.min(820, (VB_W - 160 - (cols - 1) * 24) / cols);
  const cellH = rows >= 4 ? 180 : rows === 3 ? 220 : 260;
  const gridW = cols * cellW + (cols - 1) * 24;
  const gridH = rows * cellH + (rows - 1) * 24;
  const startX = (VB_W - gridW) / 2;
  // Pin the grid below the RECAP header rather than centring the whole
  // panel — keeps the header in the same place regardless of item count.
  const startY = Math.max(140, (VB_H - gridH) / 2);

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit   ={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <rect x={0} y={0} width={VB_W} height={VB_H} fill="rgba(6,16,30,0.92)" />
      <text x={VB_W / 2} y={Math.max(80, startY - 50)}
            textAnchor="middle"
            fill="#5baaff" fontSize={36} fontWeight={800}
            fontFamily="'JetBrains Mono',monospace"
            style={{ letterSpacing: '0.24em' }}>
        RECAP
      </text>
      {items.map((it, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (cellW + 24);
        const y = startY + row * (cellH + 24);
        return <RecapCell key={it.id} item={it} x={x} y={y} w={cellW} h={cellH} delay={0.08 * i} />;
      })}
    </motion.g>
  );
}

function RecapCell({ item, x, y, w, h, delay }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const stroke = item.kind === 'date' ? '#f5c542' : '#5baaff';
  return (
    <motion.g
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut', delay }}
    >
      <rect x={x} y={y} width={w} height={h} rx={16}
            fill="rgba(16,32,64,0.95)" stroke={stroke} strokeWidth={3} />
      {item.kind === 'stat' && (
        <>
          <text x={cx} y={cy - 8} textAnchor="middle"
                fill={stroke} fontSize={70} fontWeight={900}
                fontFamily="'JetBrains Mono',monospace">
            {item.value}
          </text>
          {item.label && (
            <text x={cx} y={cy + 50} textAnchor="middle"
                  fill="#ddeaf8" fontSize={22} fontWeight={500}
                  fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
              {truncate(item.label, 38)}
            </text>
          )}
        </>
      )}
      {item.kind === 'date' && (
        <>
          <text x={cx} y={y + 36} textAnchor="middle"
                fill={stroke} fontSize={18} fontWeight={800}
                fontFamily="'JetBrains Mono',monospace"
                style={{ letterSpacing: '0.22em' }}>
            DATE
          </text>
          <text x={cx} y={cy + (item.label ? 0 : 22)} textAnchor="middle"
                fill="#ddeaf8" fontSize={item.label ? 48 : 56} fontWeight={800}
                fontFamily="'JetBrains Mono',monospace">
            {item.value}
          </text>
          {item.label && (
            <text x={cx} y={cy + 48} textAnchor="middle"
                  fill="#ddeaf8" fontSize={20} fontWeight={500}
                  fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
              {truncate(item.label, 38)}
            </text>
          )}
        </>
      )}
      {item.kind === 'text' && (() => {
        const lines = wrapTwoLines(item.text, 26);
        return lines.map((ln, i) => (
          <text key={i}
                x={cx}
                y={cy + (i - (lines.length - 1) / 2) * 32 + 10}
                textAnchor="middle"
                fill="#ddeaf8" fontSize={26} fontWeight={600}
                fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
            {ln}
          </text>
        ));
      })()}
    </motion.g>
  );
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function CaptionStrip({ text }) {
  return (
    <g>
      <rect x={20} y={CAPTION_Y} width={VB_W - 40} height={CAPTION_H} rx={14}
            fill="rgba(12,24,41,0.85)" stroke="rgba(91,170,255,0.25)" strokeWidth={2} />
      <text x={CAPTION_PAD_X} y={CAPTION_Y + 30}
            fill="#5baaff" fontSize={16} fontWeight={700}
            fontFamily="'JetBrains Mono',monospace"
            style={{ letterSpacing: '0.18em' }}>
        SOURCE EXCERPT
      </text>
      <AnimatePresence mode="wait">
        {text && (
          <motion.text
            key={text}
            x={CAPTION_PAD_X} y={CAPTION_Y + 78}
            fill="#ddeaf8" fontSize={30} fontWeight={500}
            fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            {text.length > 110 ? text.slice(0, 107).trimEnd() + '…' : text}
          </motion.text>
        )}
      </AnimatePresence>
    </g>
  );
}

function SubtitleStrip({ text, attribution }) {
  // Bottom-of-stage strip used when a callout already owns the upper third.
  // Single-line truncation keeps the strip a fixed height; bubble-wrap
  // happens in the main SpeechBubble path. Anchored against the ground
  // line so the actors can stand above it without occlusion.
  const stripY = GROUND_Y + 20;
  const stripH = 130;
  const padX   = 36;
  const display = text.length > 90 ? text.slice(0, 87).trimEnd() + '…' : text;
  return (
    <motion.g
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit   ={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <rect x={40} y={stripY} width={VB_W - 80} height={stripH} rx={18}
            fill="rgba(12,24,41,0.94)" stroke="rgba(91,170,255,0.45)" strokeWidth={3} />
      {attribution && (
        <text x={40 + padX} y={stripY + 32}
              fill="#5baaff" fontSize={20} fontWeight={800}
              fontFamily="'JetBrains Mono',monospace"
              style={{ letterSpacing: '0.2em' }}>
          {String(attribution).toUpperCase()}
        </text>
      )}
      <text x={40 + padX} y={stripY + 92}
            fill="#ddeaf8" fontSize={40} fontWeight={600}
            fontFamily="'Inter',ui-sans-serif,system-ui,sans-serif">
        “{display}”
      </text>
    </motion.g>
  );
}

function ActorOnStage({ actor, propRefs, activeBeatId, isSpeaker, dimmed, suppressSpeech, crowded, hideBody }) {
  const x = positionToX(actor.position);
  const offstageX = (actor.position === 'offstage')
    ? POSITION_X_OFFSTAGE_LEFT
    : null;
  const targetX = offstageX ?? x;

  const holdingProp = actor.holding ? propRefs[actor.holding] : null;
  const isPiloting = actor.mode === 'piloting' && holdingProp;

  const groundedY = GROUND_Y - ACTOR_HEIGHT;
  const flightY   = isPiloting ? GROUND_Y - ACTOR_HEIGHT - 320 : groundedY;

  // Name label only renders during the beat that fired show-name. After
  // that beat the actor is identified solely by their shortLabel under the
  // feet — keeps the head area clear for speech.
  const nameVisible = actor.nameShownAt && actor.nameShownAt === activeBeatId;

  const isArguing = actor.mode === 'arguing';

  // Walk-cycle trigger. When the actor's stage slot changes (enter / walk-to
  // / exit), bump walkCount so the Stickman replays its leg-cycle keyframe.
  // The framer-motion translate on the outer motion.g moves the body across
  // stage over ~0.6s; the stickman's walk cycle runs for the same duration,
  // so feet visibly step while the figure slides. Offstage→onstage entries
  // count as walks too.
  const prevPositionRef = useRef(actor.position);
  const [walkCount, setWalkCount] = useState(0);
  useEffect(() => {
    if (prevPositionRef.current !== actor.position && actor.position !== 'offstage') {
      setWalkCount(c => c + 1);
    }
    prevPositionRef.current = actor.position;
  }, [actor.position]);

  return (
    <motion.g
      initial={false}
      animate={{
        x: targetX - ACTOR_HALF_W,
        y: flightY,
        opacity: dimmed ? 0.45 : 1,
      }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      {/* "Speaker spotlight" — soft glow ring under the speaker to make the
          active actor unambiguous at a glance. */}
      {isSpeaker && !isPiloting && (
        <motion.ellipse
          cx={ACTOR_HALF_W} cy={ACTOR_HEIGHT - 6}
          rx={ACTOR_HALF_W * 1.6} ry={28}
          fill="rgba(91,170,255,0.22)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      )}

      {isPiloting && holdingProp && (
        <>
          <g transform={`translate(${-ACTOR_HALF_W * 1.1}, ${ACTOR_HEIGHT - 40}) scale(${ACTOR_SCALE * 1.5})`}>
            <Prop type={holdingProp.type} label={holdingProp.label} />
          </g>
          {/* Aircraft identifier — always shown so the viewer can read what
              they're seeing rather than guessing from a silhouette. */}
          <g transform={`translate(${ACTOR_HALF_W}, ${ACTOR_HEIGHT + 280})`}>
            <rect
              x={-150} y={-30}
              width={300} height={56}
              rx={10}
              fill="rgba(12,24,41,0.92)"
              stroke="#5baaff"
              strokeWidth={3}
            />
            <text
              x={0} y={10}
              textAnchor="middle"
              fill="#5baaff"
              fontSize={28}
              fontWeight={800}
              fontFamily="'JetBrains Mono','Fira Code',ui-monospace,monospace"
              style={{ letterSpacing: '0.18em' }}
            >
              {aircraftLabelText(holdingProp)}
            </text>
          </g>
        </>
      )}

      {/* SVG stickman body — hidden when the 3D renderer is active, since the
          3D overlay draws its own actor at the same x/y. 2D overlays around
          the actor (rank insignia, name label, speech bubble) remain so the
          existing positioning logic keeps working.
          OUTER: continuous "breathing" via a CSS keyframe animation in
          main.css (.brief-reel-stickman-breathe). transform-origin lives
          in the CSS rule using transform-box: fill-box so it anchors to
          the stickman's own bbox — setting transform-origin inline here
          would override it back to viewport coords and break the visual.
          The only inline style is the per-actor animation-delay, derived
          from a stable hash of the actor id so two stickmen on stage
          don't breathe in lockstep.
          INNER: one-shot pulse when pulseCount bumps, or a continuous
          shake while in arguing mode. The transforms compose, so
          breathing keeps running even during a pulse. */}
      {!hideBody && (
      <g
        className="brief-reel-stickman-breathe"
        style={{ animationDelay: `-${breathPhaseFor(actor.id)}s` }}
      >
        <motion.g
          key={`gesture-${actor.pulseCount || 0}`}
          animate={
            isArguing
              ? { rotate: [-2.5, 2.5, -2.5], scale: 1 }
              : actor.pulseCount > 0
                ? { scale: [1, 1.12, 1], rotate: 0 }
                : { scale: 1, rotate: 0 }
          }
          transition={
            isArguing
              ? { duration: 0.45, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.6, ease: 'easeOut' }
          }
          style={{ transformOrigin: `${ACTOR_HALF_W}px ${ACTOR_HEIGHT}px` }}
        >
          <g transform={`scale(${ACTOR_SCALE})`}>
            <Stickman
              faction={actor.faction}
              headgear={actor.headgear}
              mode={actor.mode}
              saluteCount={actor.saluteCount}
              walkCount={walkCount}
              rank={actor.rank}
              shortLabel={actor.shortLabel}
            />
          </g>
        </motion.g>
      </g>
      )}

      {/* Rank insignia moved INTO the Stickman primitive (see Stickman.jsx).
          Rendering it inside the scaled stickman group means the badge
          inherits the figure's breathing/gesture transforms — it stays
          welded to the cap during every animation. The previous outer-
          wrapper rendering used a 52-diameter disc that was wider than
          the cap itself and never moved with the head, which read as a
          floating mask rather than a cap badge. */}

      <AnimatePresence>
        {nameVisible && (
          <motion.g
            key="name-label"
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit   ={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          >
            <TextLabel text={actor.name} cx={ACTOR_HALF_W} cy={-90} big />
          </motion.g>
        )}
      </AnimatePresence>

      {/* When multiple actors are on stage, tighten the bubble's max width
          and shift its anchor outward (left-actor → bubble drifts left,
          right-actor → drifts right) so two neighbouring bubbles don't
          collide in the centre band. Centre-positioned actors stay centred. */}
      {(() => {
        const bubbleMax = crowded ? 440 : 720;
        const bubbleDx  = !crowded ? 0
          : actor.position === 'left'  ? -90
          : actor.position === 'right' ?  90
          : 0;
        return (
          <g transform={`translate(${ACTOR_HALF_W + bubbleDx}, ${nameVisible ? -170 : -50})`}>
            <SpeechBubble text={suppressSpeech ? '' : actor.speech} maxWidth={bubbleMax} />
          </g>
        );
      })()}
    </motion.g>
  );
}

