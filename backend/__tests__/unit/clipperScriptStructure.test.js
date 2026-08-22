/**
 * The structural claims a generated script makes about itself
 * (backend/services/clipperAi.js).
 *
 * A good hook only buys the first two seconds. Most short-form videos are lost
 * in the middle, and a middle with no shape is a list of facts in the order
 * they were remembered - so the writer is asked to commit to a shape, mark
 * where it re-hooks, and put its best material last.
 *
 * The prompt does the asking. What is tested here is what happens to the
 * answer, because a model that names a shape it did not follow, or marks four
 * re-hooks, must not be able to write that into the document.
 */

jest.mock('../../utils/openRouter', () => ({ callOpenRouter: jest.fn() }));

const { callOpenRouter } = require('../../utils/openRouter');
const { generateScript } = require('../../services/clipperAi');

const FACTS = [
  { factKey: 'test:flag:0', grade: 'green', text: 'FLAG runs for sixty seconds.' },
];

const IDEA = { oneLiner: 'What FLAG actually tests', hook: 'Most people misread FLAG.', angle: 'timing' };

// What the model returned, as the API would hand it back.
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

const run = () => generateScript({ idea: IDEA, facts: FACTS });

beforeEach(() => jest.clearAllMocks());

describe('the shape a script commits to', () => {
  it('records a shape the model actually chose', async () => {
    givenModelReturns({ title: 'FLAG', format: 'myth-bust', beats: [beat('b1')], outro: '' });
    expect((await run()).format).toBe('myth-bust');
  });

  // Otherwise a shape the model invented quietly becomes a fourth format, and
  // "which shape is this" stops meaning anything.
  it('refuses a shape that is not one of ours', async () => {
    givenModelReturns({ title: 'FLAG', format: 'story-arc', beats: [beat('b1')], outro: '' });
    expect((await run()).format).toBe('');
  });

  it('leaves the shape empty when none was given', async () => {
    givenModelReturns({ title: 'FLAG', beats: [beat('b1')], outro: '' });
    expect((await run()).format).toBe('');
  });
});

describe('the re-hook', () => {
  const marked = (script) => script.beats.map((b, i) => (b.rehook ? i : -1)).filter(i => i >= 0);

  it('carries one through', async () => {
    givenModelReturns({
      beats: [beat('b1'), beat('b2'), beat('b3', { rehook: true }), beat('b4')],
      outro: '',
    });
    expect(marked(await run())).toEqual([2]);
  });

  // A "new question" on beat one is the hook by another name, so it is not a
  // re-hook and marking it as one would make the count meaningless.
  it('never lets the opening beat be the re-hook', async () => {
    givenModelReturns({ beats: [beat('b1', { rehook: true }), beat('b2')], outro: '' });
    expect(marked(await run())).toEqual([]);
  });

  it('keeps the middle one when the model marked several', async () => {
    givenModelReturns({
      beats: [beat('b1'), beat('b2', { rehook: true }), beat('b3', { rehook: true }),
        beat('b4', { rehook: true }), beat('b5')],
      outro: '',
    });
    expect(marked(await run())).toEqual([2]);
  });

  it('leaves an unmarked script unmarked', async () => {
    givenModelReturns({ beats: [beat('b1'), beat('b2')], outro: '' });
    expect(marked(await run())).toEqual([]);
  });
});

describe('what the prompt asks for', () => {
  const systemPrompt = () => callOpenRouter.mock.calls[0][0].body.messages[0].content;

  it('names the shapes it will accept', async () => {
    givenModelReturns({ beats: [beat('b1')], outro: '' });
    await run();
    for (const shape of ['LIST', 'MYTH-BUST', 'ONE-MISTAKE']) {
      expect(systemPrompt()).toContain(shape);
    }
  });

  it('asks for a re-hook and for the best material last', async () => {
    givenModelReturns({ beats: [beat('b1')], outro: '' });
    await run();
    expect(systemPrompt()).toContain('RE-HOOK');
    expect(systemPrompt()).toContain('STRONGEST FACT LAST');
  });
});

// The same generation pass writes the stock queries, and an abstract one fails
// silently - it returns plenty of results that are all wrong.
describe('stock queries in a generated script', () => {
  it('constrains what the model asked to search for', async () => {
    givenModelReturns({
      beats: [
        beat('b1', { visual: { kind: 'stock', query: 'determination and focus' } }),
        beat('b2', { visual: { kind: 'stock', query: 'radar screen sweep' } }),
      ],
      outro: '',
    });
    const script = await run();
    expect(script.beats[0].visual.query).not.toMatch(/determination/);
    expect(script.beats[1].visual.query).toBe('radar screen sweep');
  });

  it('leaves a capture beat without a stock query at all', async () => {
    givenModelReturns({
      beats: [beat('b1', { visual: { kind: 'capture', recipeId: 'play-dpt' } })],
      outro: '',
    });
    const script = await run();
    expect(script.beats[0].visual.query).toBe('');
    expect(script.beats[0].visual.recipeId).toBe('play-dpt');
  });
});
