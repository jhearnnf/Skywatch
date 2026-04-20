import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');

const BG = '#06101e';
const RING = '#1d4ed8';
const INNER = '#5baaff';

// Full-bleed icon: logo fills ~85% of the canvas on a dark navy background.
// Used for icon-192, icon-512, and apple-touch-icon.
function fullBleedSvg(size) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  // content box = 85% of canvas, centered — maps original viewBox 40 → 0.85*s
  const scale = (s * 0.85) / 40;
  const off = (s - 40 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" fill="${BG}"/>
    <g transform="translate(${off} ${off}) scale(${scale})">
      <circle cx="20" cy="20" r="17" stroke="${RING}" stroke-width="2.2" fill="none"/>
      <line x1="20" y1="1"  x2="20" y2="12" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="20" y1="28" x2="20" y2="39" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="1"  y1="20" x2="12" y2="20" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="28" y1="20" x2="39" y2="20" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="20" cy="20" r="7" stroke="${INNER}" stroke-width="1.8" fill="none"/>
      <circle cx="20" cy="20" r="2.5" fill="${INNER}"/>
    </g>
  </svg>`;
}

// Maskable icon: Android's adaptive mask may crop to ~80% inner circle.
// Keep the logo inside that safe zone (~60% of canvas) on a solid background.
function maskableSvg(size) {
  const s = size;
  const scale = (s * 0.60) / 40;
  const off = (s - 40 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" fill="${BG}"/>
    <g transform="translate(${off} ${off}) scale(${scale})">
      <circle cx="20" cy="20" r="17" stroke="${RING}" stroke-width="2.2" fill="none"/>
      <line x1="20" y1="1"  x2="20" y2="12" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="20" y1="28" x2="20" y2="39" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="1"  y1="20" x2="12" y2="20" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="28" y1="20" x2="39" y2="20" stroke="${RING}" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="20" cy="20" r="7" stroke="${INNER}" stroke-width="1.8" fill="none"/>
      <circle cx="20" cy="20" r="2.5" fill="${INNER}"/>
    </g>
  </svg>`;
}

async function render(svg, outPath) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(outPath, buf);
  console.log('wrote', outPath);
}

await render(fullBleedSvg(192), resolve(publicDir, 'icon-192.png'));
await render(fullBleedSvg(512), resolve(publicDir, 'icon-512.png'));
await render(fullBleedSvg(180), resolve(publicDir, 'apple-touch-icon.png'));
await render(maskableSvg(512), resolve(publicDir, 'icon-maskable-512.png'));
