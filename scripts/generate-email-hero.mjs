// Renders the animated radar hero used at the top of the CBAT questionnaire
// email (backend/utils/emailHero.js) to public/email/radar-hero.gif.
//
// A GIF, not CSS, because email clients are not browsers: Gmail, Outlook.com
// and the Outlook apps strip @keyframes, animation and conic-gradient, so a
// CSS radar arrives frozen and half-drawn. An animated GIF plays in every
// major client; classic Outlook for Windows shows the first frame, which is a
// complete static scope and therefore a perfectly good fallback.
//
// Each frame is an SVG rasterised by sharp, stacked into one tall raw buffer
// and encoded with sharp's animated GIF writer (libvips + cgif). Inter-frame
// optimisation keeps the size down: pixels that do not change between frames
// are written as transparent, and most of the hero is static navy.
//
// Run:  node scripts/generate-email-hero.mjs
// The output is committed, so the backend never needs to render anything.

import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'email');
const OUT     = resolve(OUT_DIR, 'radar-hero.gif');

// Layout in CSS pixels. The GIF is rendered at SCALE× and displayed at this
// size so it stays crisp on retina screens.
const W = 520;
const H = 220;
const SCALE = 2;

const NAVY  = '#06101e';
const BLUE  = '#5baaff';
const LIGHT = '#8ec5ff';

// One full rotation. Frame delay is in whole centiseconds because that is all
// the GIF format can store, so FRAMES × DELAY_CS is the true loop length.
const FRAMES   = 48;
const DELAY_CS = 7;   // 48 × 70ms = 3.36s per rotation

const CX = W / 2;
const CY = H / 2;
const R  = 78;         // outer ring radius

// Contacts on the scope: clockwise angle from 12 o'clock and radius as a
// fraction of R. Spread around the dial so something lights up throughout the
// rotation rather than everything flashing at once.
const BLIPS = [
  { angle: 40,  r: 0.62 },
  { angle: 150, r: 0.42 },
  { angle: 250, r: 0.74 },
  { angle: 315, r: 0.30 },
];

const SWEEP_DEG   = 120;   // length of the trailing wedge
const SWEEP_STEPS = 64;    // stacked wedges used to fake a conic gradient
const SWEEP_PEAK  = 0.62;  // beam opacity at the leading edge

const deg2rad = (d) => (d * Math.PI) / 180;

// Point on the scope at a clockwise angle from 12 o'clock.
function polar(angle, radius) {
  const a = deg2rad(angle - 90);
  return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
}

function wedgePath(from, to, radius) {
  const a = polar(from, radius);
  const b = polar(to, radius);
  const large = to - from > 180 ? 1 : 0;
  return `M${CX} ${CY} L${a.x.toFixed(2)} ${a.y.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
}

// The trailing beam. Brightest at the leading edge, fading to nothing over
// SWEEP_DEG behind it. SVG has no conic gradient, so it is SWEEP_STEPS
// translucent wedges that all end at the leading edge and start progressively
// further back: where they overlap the alpha builds up, which IS the gradient.
// Stacking rather than tiling means no wedge shares an edge with its
// neighbour, so there are no hairline seams to anti-alias.
function sweep(lead) {
  // Alpha per layer such that the full stack at the leading edge reaches SWEEP_PEAK.
  const alpha = 1 - (1 - SWEEP_PEAK) ** (1 / SWEEP_STEPS);
  let out = '';
  for (let i = 1; i <= SWEEP_STEPS; i++) {
    const back = lead - SWEEP_DEG * (i / SWEEP_STEPS) ** 1.6;
    out += `<path d="${wedgePath(back, lead, R)}" fill="${BLUE}" fill-opacity="${alpha.toFixed(4)}"/>`;
  }
  const tip = polar(lead, R);
  out += `<line x1="${CX}" y1="${CY}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" stroke="url(#edge)" stroke-width="2" stroke-linecap="round"/>`;
  return out;
}

// A blip lights the moment the beam passes it and decays over the next half
// rotation. `phase` is how far past the blip the leading edge currently is,
// as a fraction of a rotation.
function blipOpacity(phase) {
  const decay = Math.max(0, 1 - phase / 0.55);
  return 0.18 + 0.82 * decay * decay;
}

function blips(lead) {
  return BLIPS.map(({ angle, r }) => {
    const p = polar(angle, r * R);
    const phase = (((lead - angle) % 360) + 360) % 360 / 360;
    const o = blipOpacity(phase);
    const glowR = 7 + 5 * o;
    return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${glowR.toFixed(2)}" fill="url(#glow)" opacity="${(o * 0.9).toFixed(3)}"/>`
         + `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="${LIGHT}" opacity="${o.toFixed(3)}"/>`;
  }).join('');
}

// One ring per rotation, growing out from the centre and fading as it goes.
function ping(progress) {
  const radius  = R * (0.25 + 0.95 * progress);
  const opacity = 0.75 * (1 - progress) ** 1.4;
  return `<circle cx="${CX}" cy="${CY}" r="${radius.toFixed(2)}" fill="none" stroke="${BLUE}" stroke-width="1.2" opacity="${opacity.toFixed(3)}"/>`;
}

// The scope is drawn as the SkyWatch crosshair logo (public/favicon.svg)
// scaled up, so the brand mark IS the radar rather than a badge stuck on it.
// The logo is a 40×40 box with the ring at r=17; LOGO maps its units onto
// the hero so the outer ring lands on R. Same geometry, same two blues: the
// deep #1d4ed8 ring and cardinal ticks, the light #5baaff inner ring and dot.
// A faint intermediate range ring keeps it reading as a scope.
const LOGO = R / 17;
const DEEP = '#1d4ed8';

function logoScope() {
  const tick = (angle) => {
    const o = polar(angle, 19 * LOGO);
    const i = polar(angle, 8 * LOGO);
    return `<line x1="${o.x.toFixed(2)}" y1="${o.y.toFixed(2)}" x2="${i.x.toFixed(2)}" y2="${i.y.toFixed(2)}"/>`;
  };
  // Drawn twice: a soft blurred copy underneath for a neon glow, then the
  // crisp strokes on top.
  const mark = (extra) => `
      <g fill="none" stroke-linecap="round" ${extra}>
        <circle cx="${CX}" cy="${CY}" r="${R}" stroke="${DEEP}" stroke-width="${(2.2 * LOGO * 0.3).toFixed(2)}"/>
        <g stroke="${DEEP}" stroke-width="${(2.2 * LOGO * 0.3).toFixed(2)}">${[0, 90, 180, 270].map(tick).join('')}</g>
        <circle cx="${CX}" cy="${CY}" r="${(7 * LOGO).toFixed(2)}" stroke="${BLUE}" stroke-width="${(1.8 * LOGO * 0.3).toFixed(2)}"/>
      </g>`;
  return `
    <circle cx="${CX}" cy="${CY}" r="${(R * 0.62).toFixed(2)}" fill="none" stroke="${BLUE}" stroke-opacity="0.16" stroke-width="1" stroke-dasharray="2 4"/>
    ${mark('filter="url(#neon)" opacity="0.8"')}
    ${mark('')}`;
}

// Letter-spaced wordmark tucked inside the top-left bracket, matching the
// TopBar's "SKYWATCH" treatment.
function wordmark() {
  return `<text x="40" y="47" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="11" font-weight="700" letter-spacing="3.2" fill="${BLUE}">SKYWATCH</text>`;
}

// Everything that does not move: background glow, tactical grid, corner
// brackets, rings, ticks and crosshair. Identical on every frame so the
// encoder drops it after the first.
function staticLayer() {
  const grid = [];
  for (let x = 20; x < W; x += 40) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
  for (let y = 30; y < H; y += 40) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);

  const ticks = [];
  for (let a = 30; a < 360; a += 30) {
    if (a % 90 === 0) continue; // the logo's cardinal ticks sit here
    const len = a % 90 === 0 ? 7 : 4;
    const o = polar(a, R - 1);
    const i = polar(a, R - 1 - len);
    ticks.push(`<line x1="${o.x.toFixed(2)}" y1="${o.y.toFixed(2)}" x2="${i.x.toFixed(2)}" y2="${i.y.toFixed(2)}"/>`);
  }

  const b = 14; // bracket arm length
  const m = 18; // inset from the hero edge
  const brackets = `
    <path d="M${m} ${m + b} V${m} H${m + b}"/>
    <path d="M${W - m - b} ${m} H${W - m} V${m + b}"/>
    <path d="M${m} ${H - m - b} V${H - m} H${m + b}"/>
    <path d="M${W - m - b} ${H - m} H${W - m} V${H - m - b}"/>`;

  return `
    <rect width="${W}" height="${H}" fill="${NAVY}"/>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <g stroke="${BLUE}" stroke-opacity="0.07" stroke-width="1">${grid.join('')}</g>
    <g stroke="${BLUE}" stroke-opacity="0.35" stroke-width="1.5" fill="none" stroke-linecap="square">${brackets}</g>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="${NAVY}" fill-opacity="0.35"/>
    ${logoScope()}
    <g stroke="${LIGHT}" stroke-opacity="0.45" stroke-width="1">${ticks.join('')}</g>
    ${wordmark()}`;
}

function frameSvg(i) {
  const progress = i / FRAMES;
  const lead = progress * 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="neon" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.5"/>
    </filter>
    <radialGradient id="bg" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${BLUE}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${BLUE}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow">
      <stop offset="0%" stop-color="${BLUE}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${BLUE}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="edge" gradientUnits="userSpaceOnUse" x1="${CX}" y1="${CY}" x2="${polar(lead, R).x}" y2="${polar(lead, R).y}">
      <stop offset="0%" stop-color="${BLUE}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${LIGHT}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  ${staticLayer()}
  ${ping(progress)}
  ${sweep(lead)}
  ${blips(lead)}
  <circle cx="${CX}" cy="${CY}" r="14" fill="url(#glow)"/>
  <circle cx="${CX}" cy="${CY}" r="${(2.5 * LOGO * 0.45).toFixed(2)}" fill="${BLUE}"/>
</svg>`;
}

async function main() {
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await sharp(Buffer.from(frameSvg(i))).ensureAlpha().raw().toBuffer();
    frames.push(buf);
  }

  const gif = await sharp(Buffer.concat(frames), {
    raw: { width: W * SCALE, height: H * SCALE * FRAMES, channels: 4, pageHeight: H * SCALE },
  })
    .gif({
      delay: Array(FRAMES).fill(DELAY_CS * 10),
      loop: 0,
      colours: 128,
      effort: 10,
      dither: 0.8,
      interFrameMaxError: 6,
      interPaletteMaxError: 3,
    })
    .toBuffer();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, gif);
  console.log(`wrote ${OUT} (${(gif.length / 1024).toFixed(0)} KB, ${FRAMES} frames @ ${DELAY_CS * 10}ms)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
