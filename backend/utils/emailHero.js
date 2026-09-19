'use strict';

/**
 * The animated radar hero at the top of the CBAT questionnaire email.
 *
 * Email clients are not browsers, so every choice here is about what survives
 * the three worlds an email lands in:
 *
 *   - Apple Mail / iOS Mail / Outlook for Mac (WebKit): the full animation runs.
 *     The sweep rotates, the blips light up as the beam passes them, the outer
 *     ring pings and the accent bar shimmers.
 *   - Gmail (web + apps): `@keyframes`, `animation` and `position` are stripped
 *     but everything else stays. The inline styles are therefore a complete
 *     STATIC radar on their own (a fixed sweep wedge, dim blips, the rings and
 *     crosshair) and the animation only ever overrides them. Nothing here relies
 *     on positioning: the layers are stacked with zero-height wrappers, which
 *     Gmail honours, so the scope still reads as one drawing.
 *   - Outlook for Windows (Word engine): no border-radius, no gradients, no
 *     transforms. The whole hero is wrapped in an `<!--[if !mso]>` conditional
 *     so those readers simply get the email as it was before.
 *
 * Only the questionnaire uses it (surveyEmail.js). The transactional mailers
 * in email.js deliberately keep the plainer header.
 */

const BLUE   = '#5baaff';
const NAVY   = '#06101e';
const PERIOD = '3.2s';   // one full rotation; the blip delays below are angles on this clock

// Blips sit at a fixed angle and radius on the scope. A blip lights the moment
// the sweep's leading edge reaches it, so its animation delay is simply its
// angle as a fraction of the rotation period. Angles are clockwise from 12
// o'clock, matching the sweep's start position.
//
// (x, y) are pre-computed from angle/radius about the 48px centre and then
// expressed as an offset inside a 48px quadrant cell of the crosshair table.
const BLIPS = [
  { cls: 'sw-blip-1', delay: '0.36s', cell: 'tr', x: 19, y: 25 }, //  40°, r 30
  { cls: 'sw-blip-2', delay: '1.33s', cell: 'br', x: 11, y: 19 }, // 150°, r 22
  { cls: 'sw-blip-3', delay: '2.22s', cell: 'bl', x: 16, y: 12 }, // 250°, r 34
];

const CSS = `
@keyframes sw-spin    { to { transform: rotate(360deg); } }
@keyframes sw-ping    { 0% { transform: scale(.35); opacity: .9; } 100% { transform: scale(1.18); opacity: 0; } }
@keyframes sw-blip    { 0%, 100% { opacity: .18; } 6% { opacity: 1; } 55% { opacity: .18; } }
@keyframes sw-shimmer { 0% { background-position: 0 0; } 100% { background-position: 1040px 0; } }
@keyframes sw-status  { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.sw-sweep  { animation: sw-spin ${PERIOD} linear infinite; }
.sw-ping   { animation: sw-ping ${PERIOD} ease-out infinite; }
.sw-blip   { animation: sw-blip ${PERIOD} ease-out infinite; }
${BLIPS.map(b => `.${b.cls} { animation-delay: ${b.delay}; }`).join('\n')}
.sw-bar    { animation: sw-shimmer 2.6s linear infinite; }
.sw-status { animation: sw-status 1.6s ease-in-out infinite; }
`;

// A circle with a 1px brand outline. Used for the scope, the two inner rings
// and the ping.
function ring(size, extra = '') {
  return `width:${size}px;height:${size}px;border:1px solid rgba(91,170,255,.38);border-radius:50%;box-sizing:border-box;${extra}`;
}

// Layers are painted in source order; each earlier layer sits in a zero-height
// wrapper so the next one flows over it at the same y. This is what lets the
// scope stack without `position`, which Gmail strips.
function layer(inner) {
  return `<div style="height:0;overflow:visible;">${inner}</div>`;
}

function blipHtml(b) {
  return `<div class="sw-blip ${b.cls}" style="width:6px;height:6px;margin:${b.y}px 0 0 ${b.x}px;border-radius:50%;background:${BLUE};box-shadow:0 0 7px 1px rgba(91,170,255,.85);opacity:.55;"></div>`;
}

function quadrant(cell, borders) {
  const blip = BLIPS.find(b => b.cell === cell);
  return `<td valign="top" style="width:48px;height:48px;padding:0;${borders}">${blip ? blipHtml(blip) : ''}</td>`;
}

function scopeHtml() {
  // The ping: a full-size ring that grows and fades. Static fallback is
  // invisible, so a client that cannot animate never sees a stray second ring.
  const ping = layer(
    `<div class="sw-ping" style="${ring(96, `margin:0 auto;opacity:0;border-color:rgba(91,170,255,.7);`)}"></div>`,
  );

  // The sweep: the scope itself rotates, carrying a conic wedge as its
  // background plus a bright leading edge running centre to twelve o'clock.
  // Everything nested inside is rotationally symmetric, so the spin is only
  // visible on the beam.
  const edge = layer('<div style="width:2px;height:47px;margin:0 auto;background:linear-gradient(180deg,rgba(91,170,255,.15) 0%,#8ec5ff 100%);"></div>');
  const dot  = `<div style="width:6px;height:6px;margin:10px auto 0;border-radius:50%;background:${BLUE};box-shadow:0 0 8px 2px rgba(91,170,255,.9);"></div>`;
  const ring2 = `<div style="${ring(28, 'margin:15px auto 0;')}">${dot}</div>`;
  const ring1 = `<div style="${ring(60, 'margin:17px auto 0;')}">${ring2}</div>`;
  const sweep = layer(
    `<div class="sw-sweep" style="${ring(96, `margin:0 auto;background:conic-gradient(from 0deg,rgba(91,170,255,0) 0deg,rgba(91,170,255,0) 245deg,rgba(91,170,255,.42) 360deg);`)}">${edge}${ring1}</div>`,
  );

  // The crosshair and the blips share one 2×2 table, painted last so the blips
  // sit above the beam. Cell borders draw the crosshair for free.
  const v = 'border-right:1px solid rgba(91,170,255,.18);';
  const h = 'border-bottom:1px solid rgba(91,170,255,.18);';
  const grid = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
    + 'style="width:96px;height:96px;margin:0 auto;border-collapse:collapse;table-layout:fixed;">'
    + `<tr>${quadrant('tl', v + h)}${quadrant('tr', h)}</tr>`
    + `<tr>${quadrant('bl', v)}${quadrant('br', '')}</tr>`
    + '</table>';

  return ping + sweep + grid;
}

/**
 * Returns the two pieces buildEmailHTML needs: `css` for the document head and
 * `html` for the rows above the accent bar.
 */
function radarHero() {
  const status = `<span class="sw-status" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px 1px rgba(52,211,153,.8);vertical-align:middle;margin:-2px 8px 0 0;"></span>`;

  const html = `
        <!--[if !mso]><!-- -->
        <tr><td bgcolor="${NAVY}" align="center" style="background:${NAVY};background-image:radial-gradient(ellipse at 50% 40%,rgba(91,170,255,.22) 0%,rgba(91,170,255,0) 62%);padding:30px 36px 26px;">
          ${scopeHtml()}
          <p style="font-size:10px;font-weight:700;letter-spacing:0.26em;text-transform:uppercase;color:#8ec5ff;margin:20px 0 0;line-height:1;">
            ${status}Signal acquired
          </p>
        </td></tr>
        <!--<![endif]-->`;

  return { css: CSS, html };
}

/**
 * The gradient accent bar's animated form. Same colours as the static bar,
 * tiled twice as wide so background-position can slide it.
 */
const SHIMMER_BAR_STYLE = 'background:#1d4ed8;background-image:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 25%,#9cd0ff 50%,#3b82f6 75%,#1d4ed8 100%);background-size:1040px 4px;';

module.exports = { radarHero, SHIMMER_BAR_STYLE, BLIPS, PERIOD };
