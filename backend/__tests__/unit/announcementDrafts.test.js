/**
 * Announcement drafts — turning commits into player-facing update notes.
 *
 * Both external deps (GitHub, OpenRouter) are injected, so nothing here hits
 * the network.
 */
const {
  generateAnnouncementDrafts,
  parseUpdates,
  buildUserPrompt,
} = require('../../utils/announcementDrafts');

const commit = (shortSha, message) => ({
  sha: `${shortSha}0000000000000000000000000000000`,
  shortSha,
  message,
});

const aiReturning = (content) => jest.fn().mockResolvedValue({
  choices: [{ message: { content } }],
});

describe('parseUpdates', () => {
  it('reads a plain JSON object', () => {
    const out = parseUpdates('{"updates":[{"text":"Trace 2 is live.","shas":["abc1234"]}]}');
    expect(out).toEqual([{ text: 'Trace 2 is live.', shas: ['abc1234'] }]);
  });

  it('survives code fences', () => {
    const out = parseUpdates('```json\n{"updates":[{"text":"Hi","shas":[]}]}\n```');
    expect(out).toEqual([{ text: 'Hi', shas: [] }]);
  });

  it('survives surrounding prose', () => {
    const out = parseUpdates('Sure! {"updates":[{"text":"Hi","shas":[]}]} Hope that helps.');
    expect(out).toEqual([{ text: 'Hi', shas: [] }]);
  });

  it('returns nothing for unparseable output rather than throwing', () => {
    expect(parseUpdates('total nonsense')).toEqual([]);
    expect(parseUpdates('')).toEqual([]);
    expect(parseUpdates(null)).toEqual([]);
  });

  it('drops entries with no text', () => {
    const out = parseUpdates('{"updates":[{"text":"","shas":[]},{"text":"Real","shas":[]}]}');
    expect(out).toEqual([{ text: 'Real', shas: [] }]);
  });
});

describe('generateAnnouncementDrafts', () => {
  it('sends only commits that have not been announced', async () => {
    const fetchCommits = jest.fn().mockResolvedValue([
      commit('aaa1111', 'Add the Trace 2 game'),
      commit('bbb2222', 'Old news, already announced'),
    ]);
    const callAi = aiReturning('{"updates":[{"text":"Trace 2 is live.","shas":["aaa1111"]}]}');

    const out = await generateAnnouncementDrafts({
      excludeShas: ['bbb2222'], fetchCommits, callAi,
    });

    expect(out.commitsConsidered).toBe(1);
    expect(out.skipped).toBe(1);
    const prompt = callAi.mock.calls[0][0].body.messages[1].content;
    expect(prompt).toMatch(/aaa1111/);
    expect(prompt).not.toMatch(/bbb2222/);
  });

  it('does not call the AI at all when everything is already announced', async () => {
    const fetchCommits = jest.fn().mockResolvedValue([commit('aaa1111', 'Old')]);
    const callAi = aiReturning('{"updates":[]}');

    const out = await generateAnnouncementDrafts({
      excludeShas: ['aaa1111'], fetchCommits, callAi,
    });

    expect(out.updates).toEqual([]);
    expect(callAi).not.toHaveBeenCalled();
  });

  it('uses the generic OpenRouter key', async () => {
    const fetchCommits = jest.fn().mockResolvedValue([commit('aaa1111', 'Add a thing')]);
    const callAi = aiReturning('{"updates":[{"text":"A thing.","shas":["aaa1111"]}]}');

    await generateAnnouncementDrafts({ fetchCommits, callAi });

    expect(callAi.mock.calls[0][0].key).toBe('main');
  });

  it('discards SHAs the model invented', async () => {
    // A hallucinated SHA would otherwise land in the exclude list and silently
    // hide a real commit from every future run.
    const fetchCommits = jest.fn().mockResolvedValue([commit('aaa1111', 'Add a thing')]);
    const callAi = aiReturning('{"updates":[{"text":"A thing.","shas":["aaa1111","deadbee"]}]}');

    const out = await generateAnnouncementDrafts({ fetchCommits, callAi });

    expect(out.updates[0].shas).toEqual(['aaa1111']);
  });

  it('passes an empty result through — "nothing worth announcing" is a real answer', async () => {
    const fetchCommits = jest.fn().mockResolvedValue([commit('aaa1111', 'Bump dependency')]);
    const callAi = aiReturning('{"updates":[]}');

    const out = await generateAnnouncementDrafts({ fetchCommits, callAi });

    expect(out.updates).toEqual([]);
    expect(out.commitsConsidered).toBe(1);
  });

  it('caps each note at the character limit', async () => {
    const fetchCommits = jest.fn().mockResolvedValue([commit('aaa1111', 'Add a thing')]);
    const callAi = aiReturning(JSON.stringify({
      updates: [{ text: 'x'.repeat(400), shas: ['aaa1111'] }],
    }));

    const out = await generateAnnouncementDrafts({ fetchCommits, callAi });

    expect(out.updates[0].text.length).toBe(280);
  });
});

describe('buildUserPrompt', () => {
  it('lists commits as short sha + subject line', () => {
    const prompt = buildUserPrompt([commit('aaa1111', 'Add the Trace 2 game')]);
    expect(prompt).toContain('- aaa1111 Add the Trace 2 game');
  });
});
