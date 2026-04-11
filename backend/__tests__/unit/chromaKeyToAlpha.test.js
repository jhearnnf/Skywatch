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
