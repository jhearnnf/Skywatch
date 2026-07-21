/**
 * osFromUserAgent.test.js
 *
 * Best-effort OS-family detection from a browser User-Agent string, used by
 * POST /api/users/heartbeat to populate User.osSeen for Admin › Users.
 *
 * The one thing worth over-testing here is ordering: an Android UA also
 * contains the substring "Linux", so Android must be checked before the
 * generic Linux match or every Android user would show up as Linux.
 */

const { osFromUserAgent, OS_KEYS } = require('../../constants/clientPlatforms');

const UA_IPHONE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_IPAD    = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_MAC     = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const UA_LINUX   = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('osFromUserAgent', () => {
  it('detects iPhone as ios', () => {
    expect(osFromUserAgent(UA_IPHONE)).toBe('ios');
  });

  it('detects iPad as ios', () => {
    expect(osFromUserAgent(UA_IPAD)).toBe('ios');
  });

  it('detects an Android phone as android, not linux, despite "Linux" in the UA', () => {
    expect(osFromUserAgent(UA_ANDROID)).toBe('android');
  });

  it('detects Windows', () => {
    expect(osFromUserAgent(UA_WINDOWS)).toBe('windows');
  });

  it('detects Macintosh as mac', () => {
    expect(osFromUserAgent(UA_MAC)).toBe('mac');
  });

  it('detects a desktop Linux UA as linux', () => {
    expect(osFromUserAgent(UA_LINUX)).toBe('linux');
  });

  it('returns null for an empty string', () => {
    expect(osFromUserAgent('')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(osFromUserAgent(null)).toBeNull();
    expect(osFromUserAgent(undefined)).toBeNull();
  });

  it('returns null for an unrecognisable UA', () => {
    expect(osFromUserAgent('SomeCustomBot/1.0')).toBeNull();
  });

  it('exports OS_KEYS in display order', () => {
    expect(OS_KEYS).toEqual(['windows', 'mac', 'linux', 'ios', 'android']);
  });
});
