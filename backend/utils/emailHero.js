'use strict';

/**
 * The animated radar hero at the top of the CBAT questionnaire email.
 *
 * It is an animated GIF, served from the website, because email clients are
 * not browsers. The first version of this hero was CSS keyframes and it only
 * ever moved in Apple Mail: Gmail, Outlook.com and the Outlook apps strip
 * `@keyframes`, `animation` and `conic-gradient`, so most recipients got a
 * frozen, half-drawn scope. A GIF plays everywhere those clients render
 * images; classic Outlook for Windows shows the first frame, which is a
 * complete static radar and a perfectly good fallback.
 *
 * The GIF is rendered from code by scripts/generate-email-hero.mjs into
 * public/email/radar-hero.gif and committed. It has to live on the frontend
 * domain: Railway ships only backend/, so nothing under public/ exists in the
 * backend's production filesystem, and Vercel serves public/ files directly
 * ahead of the SPA rewrite. The email links to it by absolute URL under
 * CLIENT_URL, which surveyEmail.js already refuses to send with a localhost
 * value.
 *
 * The small CSS that remains (status-dot pulse, accent-bar shimmer) is
 * decoration that costs nothing when stripped. Nothing important depends on it.
 *
 * Only the questionnaire uses the hero (surveyEmail.js). The transactional
 * mailers in email.js deliberately keep the plainer header.
 */

const NAVY = '#06101e';

// Displayed size in CSS pixels. The GIF itself is rendered at 2× so it stays
// crisp on retina screens; keep these in step with W/H in the generator.
const HERO_PATH   = '/email/radar-hero.gif';
const HERO_WIDTH  = 520;
const HERO_HEIGHT = 220;

const CSS = `
@keyframes sw-shimmer { 0% { background-position: 0 0; } 100% { background-position: 1040px 0; } }
@keyframes sw-status  { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.sw-bar    { animation: sw-shimmer 2.6s linear infinite; }
.sw-status { animation: sw-status 1.6s ease-in-out infinite; }
`;

function heroImageUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, '')}${HERO_PATH}`;
}

/**
 * Returns the two pieces buildEmailHTML needs: `css` for the document head and
 * `html` for the rows above the accent bar. `baseUrl` is the public site
 * origin the GIF is fetched from.
 */
function radarHero({ baseUrl }) {
  if (!baseUrl) throw new Error('radarHero needs the public site URL to link the hero image');

  const status = `<span class="sw-status" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px 1px rgba(52,211,153,.8);vertical-align:middle;margin:-2px 8px 0 0;"></span>`;

  // width/height attributes are what Outlook for Windows sizes by; the inline
  // width:100% is for every client that lets the card shrink on a phone.
  const html = `
        <tr><td bgcolor="${NAVY}" align="center" style="background:${NAVY};padding:0;font-size:0;line-height:0;">
          <img src="${heroImageUrl(baseUrl)}" width="${HERO_WIDTH}" height="${HERO_HEIGHT}" alt="Radar sweep"
               style="display:block;width:100%;max-width:${HERO_WIDTH}px;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td bgcolor="${NAVY}" align="center" style="background:${NAVY};padding:4px 36px 24px;">
          <p style="font-size:10px;font-weight:700;letter-spacing:0.26em;text-transform:uppercase;color:#8ec5ff;margin:0;line-height:1;">
            ${status}Signal acquired
          </p>
        </td></tr>`;

  return { css: CSS, html };
}

/**
 * The gradient accent bar's animated form. Same colours as the static bar,
 * tiled twice as wide so background-position can slide it.
 */
const SHIMMER_BAR_STYLE = 'background:#1d4ed8;background-image:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 25%,#9cd0ff 50%,#3b82f6 75%,#1d4ed8 100%);background-size:1040px 4px;';

module.exports = { radarHero, heroImageUrl, SHIMMER_BAR_STYLE, HERO_PATH, HERO_WIDTH, HERO_HEIGHT };
