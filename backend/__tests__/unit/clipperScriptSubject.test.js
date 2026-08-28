/**
 * What a subject changes about a generated script
 * (backend/services/clipperAi.js).
 *
 * The complaint: watching a finished render, it was difficult to work out what
 * the product was. `mode: 'feature'` existed but was pasted into the prompt as
 * a bare label, the writer was handed one capture recipe regardless of which
 * game the video was about, and nothing checked the result.
 *
 * The prompt does the asking - that part is asserted here only where the answer
 * is acted on. What is tested is what happens to the answer.
 */

jest.mock('../../utils/openRouter', () => ({ callOpenRouter: jest.fn() }));

const { callOpenRouter } = require('../../utils/openRouter');
const { generateScript, generateIdeas, subjectBrief, topicShot, constrainQuery } =
  require('../../services/clipperAi');
const { subjectFor, allowedRecipeIds } = require('../../constants/clipperSubjects');

const FACTS = [
  { factKey: 'test:flag:0', grade: 'green', text: 'FLAG runs for sixty seconds.' },
];

const IDEA = { oneLiner: 'What FLAG actually tests', hook: 'Most people misread FLAG.', angle: 'timing' };

function givenModelReturns(payload) {
  callOpenRouter.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });
}

const beat = (id, over = {}) => ({
  id,
  text: `Line ${id}.`,
  factKeys: ['test:flag:0'],
  visual: { kind: 'stock', query: 'fighter jet runway' },
  ...over,
});

const systemPrompt = () => callOpenRouter.mock.calls[0][0].body.messages[0].content;
const userPrompt   = () => callOpenRouter.mock.calls[0][0].body.messages[1].content;

beforeEach(() => jest.clearAllMocks());

describe('the writer is told what it is promoting', () => {
  it('names the subject, what it does and the recipe that films it', async () => {
    givenModelReturns({ title: 'FLAG', format: 'list', beats: [beat('b1')], outro: '' });
    await generateScript({ idea: IDEA, facts: FACTS, mode: 'feature', subject: { key: 'flag' } });

    const system = systemPrompt();
    expect(system).toContain('FLAG');
    expect(system).toContain('play-flag');
    expect(userPrompt()).toContain('play-flag');
  });

  // The old prompt offered play-dpt, cbat-home and browse-leaderboard to every
  // script, whatever it was about. A video promoting FLAG could only film DPT.
  it('offers only the recipes this video may use', async () => {
    givenModelReturns({ title: 'FLAG', format: 'list', beats: [beat('b1')], outro: '' });
    await generateScript({ idea: IDEA, facts: FACTS, mode: 'feature', subject: { key: 'flag' } });

    expect(systemPrompt()).not.toContain('play-dpt');
  });

  it('says nothing about a subject when the video has none', async () => {
    givenModelReturns({ title: 'Tips', format: 'list', beats: [beat('b1')], outro: '' });
    await generateScript({ idea: IDEA, facts: FACTS });

    expect(systemPrompt()).not.toContain('This video is promoting');
    expect(userPrompt()).toContain('nothing in particular');
  });

  it('asks for the same counts the validator enforces', () => {
    const flag = subjectFor('flag');
    const brief = subjectBrief(flag, allowedRecipeIds(flag));
    expect(brief).toContain('THREE beats');
  });
});

describe('what comes back', () => {
  it('records which subject the script was written for', async () => {
    givenModelReturns({ title: 'FLAG', format: 'list', beats: [beat('b1')], outro: '' });
    const script = await generateScript({ idea: IDEA, facts: FACTS, subject: { key: 'flag' } });
    expect(script.subject).toEqual({ kind: 'game', key: 'flag' });
  });

  it('records none when nothing was being promoted', async () => {
    givenModelReturns({ title: 'Tips', format: 'list', beats: [beat('b1')], outro: '' });
    expect((await generateScript({ idea: IDEA, facts: FACTS })).subject)
      .toEqual({ kind: 'none', key: '' });
  });

  // Left alone it fails the capture job hours later; demoted to stock it
  // silently costs the video the shot of the product it asked for.
  it('points a beat filming an unknown game at the subject instead', async () => {
    givenModelReturns({
      title: 'FLAG', format: 'list',
      beats: [beat('b1', { visual: { kind: 'capture', recipeId: 'play-invented' } })],
      outro: '',
    });
    const script = await generateScript({ idea: IDEA, facts: FACTS, subject: { key: 'flag' } });
    expect(script.beats[0].visual).toMatchObject({ kind: 'capture', recipeId: 'play-flag' });
  });

  it('leaves a recipe the video is allowed to use alone', async () => {
    givenModelReturns({
      title: 'FLAG', format: 'list',
      beats: [beat('b1', { visual: { kind: 'capture', recipeId: 'cbat-home' } })],
      outro: '',
    });
    const script = await generateScript({ idea: IDEA, facts: FACTS, subject: { key: 'flag' } });
    expect(script.beats[0].visual.recipeId).toBe('cbat-home');
  });

  it('takes the subject off the idea when the caller passes none', async () => {
    givenModelReturns({ title: 'DPT', format: 'list', beats: [beat('b1')], outro: '' });
    const script = await generateScript({
      idea: { ...IDEA, subject: 'dpt' }, facts: FACTS,
    });
    expect(script.subject.key).toBe('dpt');
  });
});

describe('ideas', () => {
  const IDEA_FACTS = [{ factKey: 'test:flag:0', grade: 'green', text: 'FLAG runs 60s.', useCount: 0 }];

  // An advert with nothing to advertise is the failure the subject exists to
  // stop, so a feature idea that lost its subject is not worth showing.
  it('discards a feature idea with no subject to point at', async () => {
    givenModelReturns({
      ideas: [
        { oneLiner: 'Showcase something', hook: 'h', angle: 'a', mode: 'feature', subject: '', factKeys: ['test:flag:0'] },
        { oneLiner: 'A timing mistake nobody expects', hook: 'h2', angle: 'a2', mode: 'tips', subject: '', factKeys: ['test:flag:0'] },
      ],
    });
    const ideas = await generateIdeas({ facts: IDEA_FACTS });
    expect(ideas).toHaveLength(1);
    expect(ideas[0].mode).toBe('tips');
  });

  it('drops a subject key that is not a real game', async () => {
    givenModelReturns({
      ideas: [{ oneLiner: 'A tip about pacing', hook: 'h', angle: 'a', mode: 'tips', subject: 'made-up', factKeys: ['test:flag:0'] }],
    });
    expect((await generateIdeas({ facts: IDEA_FACTS }))[0].subject).toBe('');
  });

  it('keeps a real subject on a tips idea', async () => {
    givenModelReturns({
      ideas: [{ oneLiner: 'A tip about pacing', hook: 'h', angle: 'a', mode: 'tips', subject: 'flag', factKeys: ['test:flag:0'] }],
    });
    expect((await generateIdeas({ facts: IDEA_FACTS }))[0].subject).toBe('flag');
  });
});

describe('a stock query with nothing filmable left in it', () => {
  // The old fallback picked a generic jet by beat index - by where the beat sat
  // rather than by what it said.
  it('reads the beat rather than counting beats', () => {
    expect(constrainQuery('mental focus', 0, 'You have to listen for the callsign.'))
      .toBe('pilot radio headset microphone');
    expect(constrainQuery('mental focus', 0, 'Every answer is a compass bearing.'))
      .toBe('aircraft compass heading indicator');
  });

  it('falls back to the generic list when the beat suggests nothing either', () => {
    expect(constrainQuery('determination', 0, 'It is harder than it looks.'))
      .toBe('fighter jet taking off runway');
  });

  it('leaves a query that already names something filmable alone', () => {
    expect(constrainQuery('cockpit instrument panel', 0, 'Listen for the callsign.'))
      .toBe('cockpit instrument panel');
  });

  it('has nothing to offer an empty beat', () => {
    expect(topicShot('')).toBeNull();
  });
});
