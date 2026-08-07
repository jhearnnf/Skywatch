/**
 * @mention parsing.
 *
 * The interesting case throughout is that SPACES ARE LEGAL in a display name,
 * so "@Guide Bot" cannot be resolved by splitting on whitespace.
 */
const {
  mentionRuns,
  mentionCandidates,
  resolveMentions,
  MENTION_LIMIT,
} = require('../../utils/chatMentions');

// Stands in for the database: matches on displayNameLower like the real query.
const fakeDb = (names) => {
  const rows = names.map((displayName, i) => ({
    _id: `id${i}`,
    displayName,
    displayNameLower: displayName.toLowerCase(),
  }));
  return async (lowerNames) => rows.filter(r => lowerNames.includes(r.displayNameLower));
};

const resolve = (body, names) =>
  resolveMentions(body, { findUsers: fakeDb(names) });

describe('mentionRuns', () => {
  it('takes the name-legal run after each @', () => {
    expect(mentionRuns('hi @Falcon how are you')).toEqual(['Falcon how are you'.slice(0, 19)]);
  });

  it('ignores an @ in the middle of a word, so emails are not mentions', () => {
    expect(mentionRuns('mail me at james@example.com')).toEqual([]);
  });

  it('ignores an @ followed by a space', () => {
    expect(mentionRuns('meet @ 5pm')).toEqual([]);
  });
});

describe('mentionCandidates', () => {
  it('offers every legal prefix, so a multi-word name can be found', () => {
    const cands = mentionCandidates('@Guide Bot hello');
    expect(cands).toContain('guide bot');
    expect(cands).toContain('guide');
  });

  it('never offers a prefix ending in a space', () => {
    expect(mentionCandidates('@Guide Bot').every(c => c === c.trim())).toBe(true);
  });

  it('respects the 3-character minimum', () => {
    expect(mentionCandidates('@ab')).toEqual([]);
  });
});

describe('resolveMentions', () => {
  it('resolves a single-word mention', async () => {
    const out = await resolve('hey @Falcon', ['Falcon']);
    expect(out.map(u => u.displayName)).toEqual(['Falcon']);
  });

  it('resolves a name containing a space', async () => {
    const out = await resolve('@Guide Bot what is the SDT?', ['Guide Bot']);
    expect(out.map(u => u.displayName)).toEqual(['Guide Bot']);
  });

  it('prefers the longest matching name', async () => {
    // Both exist. "@Guide Bot" must mean Guide Bot, not Guide.
    const out = await resolve('@Guide Bot hello', ['Guide', 'Guide Bot']);
    expect(out.map(u => u.displayName)).toEqual(['Guide Bot']);
  });

  it('still resolves the shorter name when that is what was typed', async () => {
    const out = await resolve('@Guide hello', ['Guide', 'Guide Bot']);
    expect(out.map(u => u.displayName)).toEqual(['Guide']);
  });

  it('resolves several mentions in one message', async () => {
    const out = await resolve('@Falcon and @Viper look', ['Falcon', 'Viper']);
    expect(out.map(u => u.displayName).sort()).toEqual(['Falcon', 'Viper']);
  });

  it('de-duplicates a name mentioned twice', async () => {
    const out = await resolve('@Falcon @Falcon @Falcon', ['Falcon']);
    expect(out).toHaveLength(1);
  });

  it('resolves nothing for a name that does not exist', async () => {
    expect(await resolve('@Nobody at all', ['Falcon'])).toEqual([]);
  });

  it('does not treat an email address as a mention', async () => {
    expect(await resolve('write to falcon@skywatch.test', ['Falcon'])).toEqual([]);
  });

  it('caps how many people one message can ping', async () => {
    const names = Array.from({ length: MENTION_LIMIT + 5 }, (_, i) => `Agent00${i}x`);
    const body = names.map(n => `@${n}`).join(' ');
    expect(await resolve(body, names)).toHaveLength(MENTION_LIMIT);
  });

  it('is case-insensitive', async () => {
    const out = await resolve('@falcon', ['Falcon']);
    expect(out.map(u => u.displayName)).toEqual(['Falcon']);
  });
});
