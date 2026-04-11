const sharp = require('sharp');
const { uploadBuffer } = require('./cloudinary');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-image';

// Gemini is *asked* for pure magenta, but it sometimes returns a different
// uniform colour (grey, off-white, sky blue, etc). Instead of trusting the
// prompt, we detect whatever colour actually landed on the border and key
// that out. Tolerance is a Euclidean-RGB distance: pixels inside SOLID_DIST
// go fully transparent, pixels inside EDGE_DIST get feathered alpha so the
// anti-aliased rim doesn't leave a hard halo.
const SOLID_DIST = 55;
const EDGE_DIST  = 110;

const EXTRACT_PROMPT = [
  'Return ONLY the main aircraft from this image.',
  'Remove everything else: sky, clouds, ground, runway, hangar, people, text, watermarks, other aircraft in the background.',
  'Place the aircraft on a solid pure magenta background, hex #FF00FF (bright pink), with no shadows, no gradients, no ground plane.',
  'Magenta is used because it does not appear anywhere on real aircraft — no part of the aircraft itself should be tinted magenta or pink under any circumstances.',
  'Keep the aircraft at exactly the same position, size, and orientation as in the original image — do not recentre, zoom, rotate, or crop it.',
  'Preserve the original image aspect ratio and framing.',
  'Do not add any new elements, decals, or effects.',
].join(' ');

/**
 * Call OpenRouter's Gemini 2.5 Flash Image model with an input image + edit
 * instruction. Returns the edited image as a Buffer (decoded from the data URL
 * OpenRouter embeds in the response).
 */
async function callGeminiImageEdit(imageBuffer, mimeType) {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title':       'SkyWatch',
    },
    body: JSON.stringify({
      model: MODEL,
      modalities: ['image', 'text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text',      text: EXTRACT_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));

  // OpenRouter returns image outputs as data URLs in message.images[].image_url.url
  const images = data.choices?.[0]?.message?.images;
  const first  = Array.isArray(images) && images[0]?.image_url?.url;
  if (!first) throw new Error('Gemini returned no image output');

  const match = first.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Unexpected image payload format from Gemini');
  return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
}

/**
 * Sample pixels around the border of a raw RGBA buffer and return the
 * per-channel median — a robust estimate of the background colour that
 * tolerates a small amount of aircraft bleed-over at any single edge.
 */
function detectBackgroundColor(data, info) {
  const { width, height, channels } = info;
  const rs = [], gs = [], bs = [];
  const push = (idx) => { rs.push(data[idx]); gs.push(data[idx + 1]); bs.push(data[idx + 2]); };

  for (let x = 0; x < width; x++) {
    push(x * channels);                                   // top row
    push(((height - 1) * width + x) * channels);          // bottom row
  }
  for (let y = 0; y < height; y++) {
    push((y * width) * channels);                         // left column
    push((y * width + (width - 1)) * channels);           // right column
  }

  const median = (arr) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)]; };
  return { r: median(rs), g: median(gs), b: median(bs) };
}

/**
 * Detect the background colour from the border and map pixels near it to
 * alpha=0 (with a feathered edge band). Runs entirely in-memory via sharp;
 * returns a PNG Buffer with transparent background.
 *
 * If `targetSize` is provided, the output is letterboxed (fit: contain with
 * transparent padding) to those dimensions so the cutout canvas matches the
 * source image 1:1 — that lets the frontend render the cutout with the same
 * `object-cover` treatment as the blurred backdrop, keeping the aircraft at
 * the same apparent size and position as in the original.
 */
async function chromaKeyToAlpha(rawBuffer, targetSize = null) {
  const img = sharp(rawBuffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  const { r: br, g: bg, b: bb } = detectBackgroundColor(data, info);

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= SOLID_DIST) {
      data[i + 3] = 0;
    } else if (dist < EDGE_DIST) {
      const t = (dist - SOLID_DIST) / (EDGE_DIST - SOLID_DIST);
      data[i + 3] = Math.round(data[i + 3] * t);
    }
  }

  let pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });

  if (targetSize?.width && targetSize?.height) {
    pipeline = pipeline.resize(targetSize.width, targetSize.height, {
      fit:        'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  return pipeline.png().toBuffer();
}

/**
 * Full pipeline: fetch the source image, run the Gemini edit, chroma-key the
 * result to transparent PNG, and upload it to Cloudinary under a cutouts/
 * folder. Returns `{ secure_url, public_id }` for persistence on the Media doc.
 */
async function extractSubjectToCloudinary(sourceUrl, parentPublicId) {
  if (!process.env.OPENROUTER_KEY) {
    throw new Error('OPENROUTER_KEY is not configured');
  }

  const imgRes = await fetch(sourceUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch source image (${imgRes.status})`);
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const sourceBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Capture source dimensions so the cutout canvas matches the original 1:1.
  // This lets the frontend render the cutout and the blurred backdrop with
  // identical cover/position rules, so the aircraft overlays at the same
  // size and place as in the source image.
  const sourceMeta = await sharp(sourceBuffer).metadata();
  const targetSize = sourceMeta.width && sourceMeta.height
    ? { width: sourceMeta.width, height: sourceMeta.height }
    : null;

  const edited = await callGeminiImageEdit(sourceBuffer, contentType);
  const pngBuffer = await chromaKeyToAlpha(edited.buffer, targetSize);

  const stamp    = Date.now();
  const safeBase = (parentPublicId || 'media').split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '_');
  const publicId = `cutout-${safeBase}-${stamp}`;

  const uploaded = await uploadBuffer(pngBuffer, {
    folder:    'brief-images/cutouts',
    public_id: publicId,
    format:    'png',
  });

  return { secure_url: uploaded.secure_url, public_id: uploaded.public_id };
}

module.exports = { extractSubjectToCloudinary, chromaKeyToAlpha };
