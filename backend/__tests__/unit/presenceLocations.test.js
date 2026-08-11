/**
 * Path → presence label.
 *
 * The rule that matters most here is the last group: an id in the path must
 * never survive into the label, because the label is what gets stored.
 */
const { locationLabel, LOCATIONS } = require('../../constants/presenceLocations');

describe('locationLabel', () => {
  it('names each CBAT game by the page someone is on', () => {
    expect(locationLabel('/cbat/act')).toBe('CBAT · ACT');
    expect(locationLabel('/cbat/rtt')).toBe('CBAT · Rapid Tracking');
    expect(locationLabel('/cbat/numerical-ops')).toBe('CBAT · Numerical Operations');
  });

  it('does not let a prefix swallow the route below it', () => {
    // Ordering bugs in the table show up here first: /cbat matches every game
    // path, /play matches /play/quiz, and so on.
    expect(locationLabel('/cbat')).toBe('CBAT menu');
    expect(locationLabel('/cbat/flag')).toBe('CBAT · FLAG');
    expect(locationLabel('/cbat/flag/leaderboard')).toBe('CBAT · Leaderboard');
    expect(locationLabel('/play')).toBe('Play');
    expect(locationLabel('/play/quiz')).toBe('Quiz briefs');
    expect(locationLabel('/profile')).toBe('Profile');
    expect(locationLabel('/profile/badge')).toBe('Choosing a badge');
    expect(locationLabel('/chat')).toBe('Community');
    expect(locationLabel('/chat/admin')).toBe('Community console');
    expect(locationLabel('/case-files')).toBe('Case Files');
    expect(locationLabel('/case-files/hormuz/one')).toBe('Playing a case file');
    expect(locationLabel('/case-files/hormuz/one/debrief')).toBe('Case file debrief');
  });

  it('tolerates a trailing slash', () => {
    expect(locationLabel('/cbat/act/')).toBe('CBAT · ACT');
    expect(locationLabel('/')).toBe('Landing page');
  });

  it('reduces a path with a record id to the kind of page it is', () => {
    // The whole point of the table: an admin learns someone is reading a brief,
    // and the id never reaches the database.
    expect(locationLabel('/brief/68f1a2b3c4d5e6f708192a3b')).toBe('Reading a brief');
    expect(locationLabel('/quiz/68f1a2b3c4d5e6f708192a3b')).toBe('Brief quiz');
    expect(locationLabel('/chat/68f1a2b3c4d5e6f708192a3b')).toBe('Community');
  });

  it('never returns anything containing part of the path it was given', () => {
    const ids = ['68f1a2b3c4d5e6f708192a3b', 'some-secret-slug', '900900900'];
    const paths = [
      ...ids.map(id => `/brief/${id}`),
      ...ids.map(id => `/chat/${id}`),
      ...ids.map(id => `/case-files/${id}/${id}`),
      ...ids.map(id => `/cbat/${id}/leaderboard`),
    ];
    for (const p of paths) {
      const label = locationLabel(p);
      expect(label).not.toBeNull();
      for (const id of ids) expect(label).not.toContain(id);
    }
  });

  it('drops a query string and fragment rather than labelling from them', () => {
    expect(locationLabel('/cbat/act?round=3')).toBe('CBAT · ACT');
    expect(locationLabel('/profile#stats')).toBe('Profile');
    // A search term is exactly the sort of thing that must not be stored.
    expect(locationLabel('/admin?q=someone@example.com')).toBe('Admin');
  });

  it('returns null for an unknown route instead of falling back to the path', () => {
    // The fallback is the leak: a route added later would start storing its own
    // ids without anyone touching this file.
    expect(locationLabel('/some/route/we/have/not/labelled')).toBeNull();
    expect(locationLabel('/brief')).toBeNull();
  });

  it('returns null for junk rather than throwing on it', () => {
    for (const junk of [undefined, null, 42, {}, [], '', '   ', 'not-a-path', 'https://evil.test/x']) {
      expect(locationLabel(junk)).toBeNull();
    }
    expect(locationLabel(`/${'x'.repeat(500)}`)).toBeNull();
  });

  it('keeps every label short enough for the strip', () => {
    for (const [, label] of LOCATIONS) {
      expect(label.length).toBeLessThanOrEqual(40);
    }
  });
});
