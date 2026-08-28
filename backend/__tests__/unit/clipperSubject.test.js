/**
 * clipperSubject.test.js
 *
 * A finished render was hard to read as an advert for anything. The cause was
 * structural: `mode: 'feature'` was a label the pipeline never acted on, so a
 * video "promoting" a game could name it once in the outro, film a different
 * game, or show no product at all, and nothing anywhere objected.
 *
 * These are the checks that make the complaint impossible to reproduce quietly.
 */

const {
  SUBJECTS, GAME_SUBJECTS, subjectFor, allowedRecipeIds, mentionsSubject,
  normaliseSubject,
} = require('../../constants/clipperSubjects');

const {
  checkSubject, validateScript,
  MIN_SUBJECT_MENTIONS, MIN_SUBJECT_CAPTURES,
} = require('../../utils/clipperGuardrails');

const capture = (recipeId) => ({ kind: 'capture', recipeId });
const stock   = () => ({ kind: 'stock', query: 'fighter jet' });

const beat = (id, text, visual = stock()) => ({ id, text, visual, factKeys: [] });

describe('the subject table', () => {
  it('gives every subject a spoken name, a route and a recipe', () => {
    for (const s of SUBJECTS) {
      expect(s.key).toBeTruthy();
      expect(s.spokenName).toBeTruthy();
      expect(s.what).toBeTruthy();
      expect(s.path.startsWith('/cbat')).toBe(true);
      expect(s.recipeId).toBeTruthy();
    }
  });

  it('uses a distinct recipe per subject', () => {
    const ids = SUBJECTS.map(s => s.recipeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A hallucinated key must not become a subject: an advert for a game that
  // does not exist is worse than an advert for nothing.
  it('refuses a key it does not know', () => {
    expect(subjectFor('not-a-game')).toBeNull();
    expect(normaliseSubject('not-a-game')).toEqual({ kind: 'none', key: '' });
    expect(normaliseSubject('flag')).toEqual({ kind: 'game', key: 'flag' });
  });
});

describe('allowedRecipeIds', () => {
  it('lets a game video film that game, the menu and a leaderboard', () => {
    const allowed = allowedRecipeIds(subjectFor('flag'));
    expect(allowed).toContain('play-flag');
    expect(allowed).toContain('cbat-home');
    expect(allowed).not.toContain('play-dpt');
  });

  // A tips video is not an advert and has nothing to be off-message about, so
  // it keeps the run of the list - often the game the tip is about.
  it('lets a video with no subject film anything', () => {
    expect(allowedRecipeIds(null)).toContain('play-flag');
    expect(allowedRecipeIds(null)).toContain('play-dpt');
  });
});

describe('mentionsSubject', () => {
  const flag = subjectFor('flag');

  it('finds the name however the line is cased or punctuated', () => {
    expect(mentionsSubject('FLAG throws three tasks at you.', flag)).toBe(true);
    expect(mentionsSubject('Then flag, which is worse.', flag)).toBe(true);
  });

  it('does not count the name buried inside another word', () => {
    expect(mentionsSubject('flagged for review', flag)).toBe(false);
  });

  it('accepts the long name as well as the code', () => {
    const cut = subjectFor('cut');
    expect(mentionsSubject('the cognitive updating test is relentless', cut)).toBe(true);
  });
});

describe('checkSubject', () => {
  const flag = subjectFor('flag');

  // The exact shape of the render that prompted this: the product named once,
  // at the end, over stock footage.
  it('objects when the product is named once in the outro and never shown', () => {
    const beats = [
      beat('b1', 'Most people lose this on the maths.'),
      beat('b2', 'They freeze on the second question.'),
      beat('b3', 'Try FLAG and see.'),
    ];
    const rules = checkSubject(beats, flag).map(f => f.rule);
    expect(rules).toContain('subject-unnamed');
    expect(rules).toContain('subject-unseen');
  });

  it('passes a script that names it enough and shows it early', () => {
    const beats = [
      beat('b1', 'FLAG gives you sixty seconds.', capture('play-flag')),
      beat('b2', 'Three tasks at once in FLAG.',  capture('play-flag')),
      beat('b3', 'Most people drop one.'),
      beat('b4', 'FLAG scores every one of them.', capture('play-flag')),
    ];
    expect(checkSubject(beats, flag)).toEqual([]);
  });

  it('says so when the product is only shown late', () => {
    const beats = [
      beat('b1', 'FLAG gives you sixty seconds.'),
      beat('b2', 'Three tasks at once.'),
      beat('b3', 'FLAG scores all of them.',  capture('play-flag')),
      beat('b4', 'And FLAG times you too.',   capture('play-flag')),
      beat('b5', 'Which is the hard part.',   capture('play-flag')),
    ];
    expect(checkSubject(beats, flag).map(f => f.rule)).toContain('subject-shown-late');
  });

  // Filming a different game while the voice talks about this one reads as
  // deliberate, so it blocks rather than warns.
  it('blocks a beat that films a different game', () => {
    const beats = [beat('b1', 'FLAG is fast.', capture('play-dpt'))];
    const wrong = checkSubject(beats, flag).find(f => f.rule === 'subject-wrong-capture');
    expect(wrong.severity).toBe('error');
  });

  it('has nothing to say about a video promoting nothing', () => {
    expect(checkSubject([beat('b1', 'Anything at all.')], null)).toEqual([]);
  });

  it('asks for as many mentions and shots as the prompt promises', () => {
    expect(MIN_SUBJECT_MENTIONS).toBe(3);
    expect(MIN_SUBJECT_CAPTURES).toBe(3);
  });
});

describe('validateScript with a subject', () => {
  it('reports a thin promotion as a warning, not a blocker', () => {
    const result = validateScript(
      { beats: [beat('b1', 'DPT is hard.')], outro: { copy: '' } },
      [],
      [],
      { key: 'dpt' },
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.map(f => f.rule)).toContain('subject-unseen');
  });

  it('leaves a subjectless script exactly as it was', () => {
    const result = validateScript(
      { beats: [beat('b1', 'A perfectly ordinary tip.')], outro: { copy: '' } },
      [], [],
    );
    expect(result.findings).toEqual([]);
  });
});

describe('every game subject is filmable', () => {
  // The table's own rule. A subject whose recipe the agent does not know is a
  // video that fails at record time, hours after the script was approved.
  const { RECIPES } = require('../../../clipper-agent/recipes');

  it.each(GAME_SUBJECTS.map(s => [s.key, s.recipeId]))(
    '%s names a recipe the agent has (%s)',
    (_key, recipeId) => { expect(RECIPES[recipeId]).toBeDefined(); },
  );
});
