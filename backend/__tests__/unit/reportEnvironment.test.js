/**
 * utils/reportEnvironment — what a problem report keeps about the device and
 * how it is described back to an admin.
 *
 * A real report read "the needles are off the screen" and nothing else could
 * be learned from it: no OS, no browser, no screen size. These pin down that
 * the sanitiser admits only what it knows (the values are rendered in the
 * admin panel) and that the describer turns the raw values into the lines an
 * admin actually needs — including the ones Chromium's frozen User-Agent
 * string lies about.
 */
const {
  sanitiseReportEnvironment,
  describeReportEnvironment,
  osFromUa,
  browserFromUa,
  gpuLabel,
} = require('../../utils/reportEnvironment');

const WIN_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const ANDROID_WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36';
const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:129.0) Gecko/20100101 Firefox/129.0';

function rowsOf(summary) {
  return Object.fromEntries(summary.map(r => [r.label, r.value]));
}

describe('sanitiseReportEnvironment', () => {
  it('keeps the known fields and drops the rest', () => {
    const env = sanitiseReportEnvironment({
      screenWidth: 1920, screenHeight: 1080, dpr: 1.25, touchPoints: 0,
      theme: 'cbat', online: true, favouriteColour: 'blue', __proto__: { x: 1 },
    }, WIN_CHROME_UA);
    expect(env).toEqual({
      screenWidth: 1920, screenHeight: 1080, dpr: 1.25, touchPoints: 0,
      theme: 'cbat', online: true, userAgent: WIN_CHROME_UA,
    });
  });

  it('takes the User-Agent from the request header, not the payload', () => {
    const env = sanitiseReportEnvironment({ userAgent: 'Totally/1.0 (a lie)' }, WIN_CHROME_UA);
    expect(env.userAgent).toBe(WIN_CHROME_UA);
  });

  // A bundle from before the collector shipped sends no environment at all;
  // the header alone still places the report.
  it('returns the header alone when the client sent nothing', () => {
    expect(sanitiseReportEnvironment(undefined, WIN_CHROME_UA)).toEqual({ userAgent: WIN_CHROME_UA });
    expect(sanitiseReportEnvironment('junk', WIN_CHROME_UA)).toEqual({ userAgent: WIN_CHROME_UA });
  });

  it('returns null when there is nothing usable at all', () => {
    expect(sanitiseReportEnvironment({}, undefined)).toBeNull();
    expect(sanitiseReportEnvironment({ screenWidth: 'wide', online: 'yes' }, '')).toBeNull();
  });

  it('caps strings, strips control characters and rejects objects as values', () => {
    const env = sanitiseReportEnvironment({
      webglRenderer: 'x'.repeat(500),
      uaModel: 'Pixel\u0000 7\n',
      theme: { toString: () => 'cbat' },
    }, undefined);
    expect(env.webglRenderer).toHaveLength(300);
    expect(env.uaModel).toBe('Pixel  7');
    expect(env.theme).toBeUndefined();
  });

  it('keeps only well-formed brands and gamepads, capped', () => {
    const env = sanitiseReportEnvironment({
      uaBrands: [
        { brand: 'Google Chrome', version: '128.0.6613.84' },
        { version: 'no brand' },
        'string',
        ...Array(10).fill({ brand: 'Filler', version: '1' }),
      ],
      gamepads: ['Thrustmaster T.16000M (Vendor: 044f Product: b10a)', 42, '', ...Array(6).fill('pad')],
    }, undefined);
    expect(env.uaBrands).toHaveLength(8);
    expect(env.uaBrands[0]).toEqual({ brand: 'Google Chrome', version: '128.0.6613.84' });
    expect(env.gamepads).toHaveLength(4);
    expect(env.gamepads[0]).toMatch(/Thrustmaster/);
  });
});

describe('describeReportEnvironment — OS', () => {
  // Chrome reports every Windows as NT 10.0; only the Client Hints platform
  // version can tell 10 from 11.
  it('names Windows 11 from Client Hints where the UA says NT 10.0', () => {
    const rows = rowsOf(describeReportEnvironment({
      userAgent: WIN_CHROME_UA, uaPlatform: 'Windows', uaPlatformVersion: '15.0.0',
    }));
    expect(rows.OS).toBe('Windows 11');
  });

  it('names Windows 10 from a Client Hints platform version below 13', () => {
    const rows = rowsOf(describeReportEnvironment({ uaPlatform: 'Windows', uaPlatformVersion: '10.0.0' }));
    expect(rows.OS).toBe('Windows 10');
  });

  it('admits it cannot tell 10 from 11 when only the UA is available', () => {
    expect(osFromUa(WIN_CHROME_UA)).toBe('Windows 10 or 11');
  });

  it('reads the Android version and model from Client Hints, not the reduced UA', () => {
    const rows = rowsOf(describeReportEnvironment({
      userAgent: ANDROID_WEBVIEW_UA, uaPlatform: 'Android', uaPlatformVersion: '14.0.0', uaModel: 'Pixel 7', uaMobile: true,
    }));
    expect(rows.OS).toBe('Android 14');
    expect(rows.Device).toBe('Pixel 7 · mobile');
  });

  it('does not report the reduced UA placeholder "K" as a device model', () => {
    const rows = rowsOf(describeReportEnvironment({ userAgent: ANDROID_WEBVIEW_UA }));
    expect(rows.Device).toBeUndefined();
    expect(rows.OS).toBe('Android 10');
  });

  it('reads iOS and macOS from the UA when there are no Client Hints', () => {
    expect(osFromUa(IPHONE_SAFARI_UA)).toBe('iOS 17.5');
    expect(osFromUa(MAC_FIREFOX_UA)).toBe('macOS (10.15 or later)');
  });
});

describe('describeReportEnvironment — browser', () => {
  it('prefers the named Client Hints brand over the engine and GREASE entries', () => {
    const rows = rowsOf(describeReportEnvironment({
      userAgent: WIN_CHROME_UA,
      uaBrands: [
        { brand: 'Not)A;Brand', version: '99.0.0.0' },
        { brand: 'Chromium', version: '128.0.6613.84' },
        { brand: 'Microsoft Edge', version: '128.0.2739.42' },
      ],
    }));
    expect(rows.Browser).toBe('Microsoft Edge 128');
  });

  it('falls back to the UA string for browsers without Client Hints', () => {
    expect(browserFromUa(IPHONE_SAFARI_UA)).toBe('Safari 17.5');
    expect(browserFromUa(MAC_FIREFOX_UA)).toBe('Firefox 129');
    expect(browserFromUa(WIN_CHROME_UA)).toBe('Chrome 128');
  });

  it('describes the app as the app, with the WebView engine version', () => {
    const rows = rowsOf(describeReportEnvironment({ userAgent: ANDROID_WEBVIEW_UA }, { clientPlatform: 'android' }));
    expect(rows.Browser).toBe('SkyWatch app (WebView, Chrome 127)');
  });
});

describe('describeReportEnvironment — display, graphics, other', () => {
  it('lays out the screen and viewport with scale, orientation and touch', () => {
    const rows = rowsOf(describeReportEnvironment({
      screenWidth: 2560, screenHeight: 1440, viewportWidth: 1280, viewportHeight: 620,
      dpr: 1.5, orientation: 'landscape-primary', touchPoints: 0,
    }));
    expect(rows.Display).toBe('screen 2560×1440, viewport 1280×620, @1.5x, landscape, no touch');
  });

  it('unwraps the GPU name from an ANGLE renderer string', () => {
    expect(gpuLabel({ webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }))
      .toBe('NVIDIA GeForce RTX 3060 (D3D11)');
    expect(gpuLabel({ webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)' }))
      .toBe('Intel(R) UHD Graphics 620 (0x00003EA0) (D3D11)');
    expect(gpuLabel({ webglRenderer: 'Apple GPU' })).toBe('Apple GPU');
    expect(gpuLabel({ webglRenderer: 'unavailable' })).toBe('WebGL unavailable');
  });

  it('lists a connected controller', () => {
    const rows = rowsOf(describeReportEnvironment({ gamepads: ['T.16000M (Vendor: 044f Product: b10a)'] }));
    expect(rows.Controls).toBe('T.16000M (Vendor: 044f Product: b10a)');
  });

  it('mentions the theme only when it is not the default, and flags offline', () => {
    const rows = rowsOf(describeReportEnvironment({ theme: 'cbat', online: false, language: 'en-GB', timezone: 'Europe/London' }));
    expect(rows.Other).toBe('cbat theme · offline at the time · en-GB · Europe/London');
    expect(rowsOf(describeReportEnvironment({ theme: 'skywatch' })).Other).toBeUndefined();
  });

  it('returns nothing for a report filed before the environment was captured', () => {
    expect(describeReportEnvironment(undefined)).toEqual([]);
    expect(describeReportEnvironment(null)).toEqual([]);
  });
});
