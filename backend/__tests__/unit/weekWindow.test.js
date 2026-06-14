const { startOfWeekUTC, nextResetAt, WEEK_MS } = require('../../utils/weekWindow');

describe('weekWindow', () => {
  it('snaps to Monday 00:00 UTC for any day in the week', () => {
    // Week of Mon 2026-06-15 .. Sun 2026-06-21 (UTC).
    const expected = '2026-06-15T00:00:00.000Z';
    expect(startOfWeekUTC(new Date('2026-06-15T00:00:00Z')).toISOString()).toBe(expected); // Monday 00:00
    expect(startOfWeekUTC(new Date('2026-06-15T23:59:59Z')).toISOString()).toBe(expected); // Monday late
    expect(startOfWeekUTC(new Date('2026-06-17T12:00:00Z')).toISOString()).toBe(expected); // Wednesday
    expect(startOfWeekUTC(new Date('2026-06-21T23:59:59Z')).toISOString()).toBe(expected); // Sunday end
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // Sunday 2026-06-14 belongs to the week starting Mon 2026-06-08.
    expect(startOfWeekUTC(new Date('2026-06-14T15:30:00Z')).toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('nextResetAt is exactly one week after the week start', () => {
    const now = new Date('2026-06-17T12:00:00Z');
    expect(nextResetAt(now).getTime() - startOfWeekUTC(now).getTime()).toBe(WEEK_MS);
    expect(nextResetAt(now).toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });
});
