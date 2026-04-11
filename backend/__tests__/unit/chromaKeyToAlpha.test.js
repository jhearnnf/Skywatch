/**
 * Unit tests for chromaKeyToAlpha — the background-removal pass applied to
 * whatever image Gemini returns. Gemini is asked for a pure-green background
 * but doesn't always comply, so the implementation samples border pixels to
 * detect the actual background colour before keying. These tests exercise
 * that detection with several hues to ensure the pipeline isn't hard-coded
 * to green any more.
 */

const sharp = require('sharp');
const { chromaKeyToAlpha } = require('../../utils/extractCutout');

/**
 * Build a PNG buffer containing a rectangular `fg` subject on a solid `bg`
 * background. Subject lives at [5..14]×[5..14] of a 20×20 canvas.
 */
async function buildSyntheticImage(bg, fg) {
  const width = 20, height = 20;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = bg[0]; pixels[i + 1] = bg[1]; pixels[i + 2] = bg[2];
  }
  for (let y = 5; y < 15; y++) {
    for (let x = 5; x < 15; x++) {
      const idx = (y * width + x) * 3;
      pixels[idx] = fg[0]; pixels[idx + 1] = fg[1]; pixels[idx + 2] = fg[2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function decodeRaw(buffer) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe('chromaKeyToAlpha', () => {
  const subjectCases = [
    { label: 'grey',       bg: [200, 200, 200] },
    { label: 'off-white',  bg: [240, 238, 232] },
    { label: 'sky blue',   bg: [150, 190, 230] },
    { label: 'pure green', bg: [0, 255, 0] },
  ];

  for (const { label, bg } of subjectCases) {
    it(`removes a ${label} background and keeps the red subject opaque`, async () => {
      const input = await buildSyntheticImage(bg, [220, 30, 30]);
      const result = await chromaKeyToAlpha(input);

      const { data, info } = await decodeRaw(result);
      expect(info.channels).toBe(4);
      // Without a targetSize the canvas matches the input dimensions.
      expect(info.width).toBe(20);
      expect(info.height).toBe(20);

      // Border pixel (top-left) should be fully transparent.
      expect(data[3]).toBe(0);

      // Subject centre (10,10) should still be opaque red.
      const centreIdx = (10 * info.width + 10) * 4;
      expect(data[centreIdx]).toBeGreaterThan(180);
      expect(data[centreIdx + 3]).toBe(255);
    });
  }

  it('does not erase a subject whose colour is unrelated to the background', async () => {
    // Grey background + dark blue subject — distance well above EDGE_DIST.
    const input = await buildSyntheticImage([210, 210, 210], [20, 40, 120]);
    const result = await chromaKeyToAlpha(input);

    const { data, info } = await decodeRaw(result);
    const centreIdx = (10 * info.width + 10) * 4;
    expect(data[centreIdx + 3]).toBe(255);
    expect(data[centreIdx + 2]).toBeGreaterThan(80);  // blue channel preserved
  });

  it('despills residual background tint from feathered rim pixels', async () => {
    // Pure-magenta border surrounding an interior strip whose pixels sit in
    // the feather band (RGB distance ~80 from magenta). Without despill the
    // strip would stay magenta-tinted and form a pink halo; with despill the
    // suppressed channel (G) gets lifted toward the dominant channels (R, B)
    // because the formula recovers the implied subject colour.
    const width = 20, height = 20;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = 255; pixels[i + 1] = 0; pixels[i + 2] = 255;
    }
    for (let y = 9; y <= 10; y++) {
      for (let x = 5; x <= 14; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = 255; pixels[idx + 1] = 80; pixels[idx + 2] = 255;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const result = await chromaKeyToAlpha(input);
    const { data, info } = await decodeRaw(result);

    const idx = (9 * info.width + 9) * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

    // Strip pixel landed in the feather band — partly transparent.
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);

    // Despill lifts the suppressed channel well above its raw value of 80.
    expect(g).toBeGreaterThan(120);

    // Dominant background channels stay at the top of the range — despill
    // never inflates a channel, only recovers the subject's true value.
    expect(r).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(200);
  });

  it('clamps opaque rim pixels that survive the alpha key', async () => {
    // The pink-halo case: pixels at distance ~140 from magenta sit *outside*
    // the feather band so they keep alpha=255, but they still carry a magenta
    // cast that reads as a pink rim. The despill-only stage clamps the bg's
    // dominant channels (R, B) down toward the pixel's low channel (G).
    const width = 20, height = 20;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = 255; pixels[i + 1] = 0; pixels[i + 2] = 255;
    }
    for (let y = 9; y <= 10; y++) {
      for (let x = 5; x <= 14; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = 255; pixels[idx + 1] = 140; pixels[idx + 2] = 255;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const result = await chromaKeyToAlpha(input);
    const { data, info } = await decodeRaw(result);

    const idx = (9 * info.width + 9) * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

    // Outside the feather band — alpha is fully opaque.
    expect(a).toBe(255);
    // Dominant channels are pulled down toward the floor (G=140) — they
    // were 255 before, now well below 220.
    expect(r).toBeLessThan(220);
    expect(b).toBeLessThan(220);
    // The floor (G) is preserved.
    expect(g).toBe(140);
  });

  it('does not blow up the suppressed channel for feather-band pixels', async () => {
    // Regression: an earlier version decoupled the despill ramp from the
    // alpha ramp, which meant feather-band pixels with a moderate cast got
    // their suppressed channel divided by a tiny number — saturating G to
    // 255 and turning the entire subject green.
    const width = 20, height = 20;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = 255; pixels[i + 1] = 0; pixels[i + 2] = 255;
    }
    for (let y = 9; y <= 10; y++) {
      for (let x = 5; x <= 14; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = 240; pixels[idx + 1] = 100; pixels[idx + 2] = 240;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const result = await chromaKeyToAlpha(input);
    const { data, info } = await decodeRaw(result);

    const idx = (9 * info.width + 9) * 4;
    const g = data[idx + 1];

    // Despill should lift G modestly, not saturate it to ~255 (the bug).
    expect(g).toBeGreaterThan(100);
    expect(g).toBeLessThan(200);
  });

  it('leaves a genuinely red subject pixel intact on a magenta background', async () => {
    // Red Arrows scenario — bright red livery on a magenta-keyed background.
    // The pixel sits "near" magenta in distance terms but its B channel is
    // low (matching the bg's low G), so the elevated-channel guard rejects
    // it and the despill-only stage leaves it alone.
    const width = 20, height = 20;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = 255; pixels[i + 1] = 0; pixels[i + 2] = 255;
    }
    for (let y = 9; y <= 10; y++) {
      for (let x = 5; x <= 14; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = 220; pixels[idx + 1] = 40; pixels[idx + 2] = 40;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const result = await chromaKeyToAlpha(input);
    const { data, info } = await decodeRaw(result);

    const idx = (9 * info.width + 9) * 4;
    expect(data[idx]).toBeGreaterThan(200);     // R preserved
    expect(data[idx + 1]).toBeLessThan(60);     // G untouched
    expect(data[idx + 2]).toBeLessThan(60);     // B untouched (would have been clamped if guard fired)
    expect(data[idx + 3]).toBe(255);            // fully opaque
  });

  it('letterboxes the cutout to a requested target size with transparent padding', async () => {
    // Square input, wider target → expect the output to match the target
    // dimensions exactly, with transparent bars on the left/right.
    const input = await buildSyntheticImage([200, 200, 200], [220, 30, 30]);
    const result = await chromaKeyToAlpha(input, { width: 40, height: 20 });

    const { data, info } = await decodeRaw(result);
    expect(info.width).toBe(40);
    expect(info.height).toBe(20);

    // Far-left column pixel — should sit inside the transparent letterbox band.
    const leftIdx = (10 * info.width + 0) * 4;
    expect(data[leftIdx + 3]).toBe(0);

    // Middle pixel — should still be inside the (resized) subject area.
    const midIdx = (10 * info.width + 20) * 4;
    expect(data[midIdx + 3]).toBe(255);
  });
});
