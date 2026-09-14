/**
 * geo.test.js — constants/geo.js
 *
 * The heartbeat's country signals: what is accepted off the wire, which
 * timezones resolve to a country, and how IP and timezone are reconciled.
 */

const { countryFromTimeZone, sanitiseGeoInfo, resolveCountry } = require('../../constants/geo');

describe('countryFromTimeZone', () => {
  it.each([
    ['Europe/London', 'GB'],
    ['Europe/Jersey', 'GB'],          // Crown dependency → UK market
    ['Europe/Dublin', 'IE'],
    ['Australia/Sydney', 'AU'],       // prefix family
    ['Australia/Lord_Howe', 'AU'],
    ['Pacific/Auckland', 'NZ'],
    ['America/Toronto', 'CA'],
    ['America/New_York', 'US'],
    ['America/Indiana/Indianapolis', 'US'],
    ['America/Argentina/Buenos_Aires', 'AR'],
    ['Asia/Famagusta', 'CY'],         // RAF Akrotiri
  ])('%s → %s', (tz, code) => {
    expect(countryFromTimeZone(tz)).toBe(code);
  });

  it.each([['UTC'], ['Etc/GMT+1'], ['Mars/Olympus_Mons'], [''], [null], [undefined]])(
    'gives no answer for %s', (tz) => { expect(countryFromTimeZone(tz)).toBeNull(); },
  );
});

describe('sanitiseGeoInfo', () => {
  it('accepts the three signals and upper-cases the country', () => {
    expect(sanitiseGeoInfo({ country: 'gb', timeZone: 'Europe/London', language: 'en-GB' }))
      .toEqual({ ipCountry: 'GB', timeZone: 'Europe/London', language: 'en-GB' });
  });

  it('drops each value that does not look like what it claims to be', () => {
    expect(sanitiseGeoInfo({ country: 'GBR', timeZone: '<script>', language: 'x'.repeat(40) }))
      .toBeNull();
    expect(sanitiseGeoInfo({ country: 'GB', timeZone: '../etc/passwd', language: 'en' }))
      .toEqual({ ipCountry: 'GB', timeZone: null, language: 'en' });
  });

  it('returns null for an unusable or absent payload', () => {
    expect(sanitiseGeoInfo(null)).toBeNull();
    expect(sanitiseGeoInfo('GB')).toBeNull();
    expect(sanitiseGeoInfo({})).toBeNull();
    expect(sanitiseGeoInfo({ country: null, timeZone: '', language: undefined })).toBeNull();
  });
});

describe('resolveCountry', () => {
  it('takes the IP when it agrees with the timezone', () => {
    expect(resolveCountry({ ipCountry: 'GB', timeZone: 'Europe/London', previous: null }))
      .toEqual({ country: 'GB', source: 'ip', mismatch: false });
  });

  it('takes the IP alone when the timezone is unknown to us', () => {
    expect(resolveCountry({ ipCountry: 'GB', timeZone: 'Etc/GMT', previous: null }))
      .toEqual({ country: 'GB', source: 'ip', mismatch: false });
    expect(resolveCountry({ ipCountry: 'GB', timeZone: null, previous: null }))
      .toEqual({ country: 'GB', source: 'ip', mismatch: false });
  });

  it('falls back to the timezone when the IP lookup gave nothing', () => {
    expect(resolveCountry({ ipCountry: null, timeZone: 'Australia/Perth', previous: null }))
      .toEqual({ country: 'AU', source: 'timezone', mismatch: false });
  });

  // A VPN on first contact: the device's own timezone is the better guess.
  it('prefers the timezone over a disagreeing IP on first contact', () => {
    expect(resolveCountry({ ipCountry: 'NL', timeZone: 'Europe/London', previous: null }))
      .toEqual({ country: 'GB', source: 'timezone', mismatch: true });
  });

  // Holiday or VPN later on: the stored answer stands, but the disagreement
  // is recorded so the admin panel can show both.
  it('keeps the stored country when IP and timezone disagree later', () => {
    expect(resolveCountry({ ipCountry: 'ES', timeZone: 'Europe/London', previous: { country: 'GB', source: 'ip' } }))
      .toEqual({ country: 'GB', source: 'ip', mismatch: true });
  });

  it('lets a real move through once both signals agree again', () => {
    expect(resolveCountry({ ipCountry: 'AU', timeZone: 'Australia/Sydney', previous: { country: 'GB', source: 'ip' } }))
      .toEqual({ country: 'AU', source: 'ip', mismatch: false });
  });

  it('gives nothing when neither signal is usable', () => {
    expect(resolveCountry({ ipCountry: null, timeZone: 'UTC', previous: { country: 'GB', source: 'ip' } })).toBeNull();
  });
});
