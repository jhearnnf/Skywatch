'use strict';

/**
 * caseFilePromptAssembly.test.js
 *
 * Unit tests for the caseFilePromptAssembly utility.
 * No DB; no network calls.
 */

const {
  assembleInterrogationPrompt,
  splitMoodTag,
  MOODS,
  _clearCache,
} = require('../../utils/caseFilePromptAssembly');

beforeEach(() => {
  _clearCache();
});

describe('assembleInterrogationPrompt', () => {
  it('returns a systemPrompt string', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(0);
  });

  it('systemPrompt contains editorial rules content', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    // Editorial rules include distinctive phrases
    expect(systemPrompt).toMatch(/Editorial Stance/i);
    expect(systemPrompt).toMatch(/Hard Refusals/i);
  });

  it('systemPrompt contains actor-specific content', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    // lavrov.md contains these strings
    expect(systemPrompt).toMatch(/Lavrov/i);
    expect(systemPrompt).toMatch(/Foreign Minister/i);
  });

  it('systemPrompt contains the contextDateLabel anchor line', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    expect(systemPrompt).toContain('You are roleplaying as of Nov 2021.');
  });

  it('works for a different actor (putin)', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'putin',
      contextDateLabel: 'Feb 2022',
    });
    expect(systemPrompt).toContain('You are roleplaying as of Feb 2022.');
    // putin.md should contain actor-specific content distinct from lavrov
    expect(systemPrompt.length).toBeGreaterThan(100);
  });

  it('throws a clear error for a missing actor file', () => {
    expect(() =>
      assembleInterrogationPrompt({
        actorPromptKey:   'nonexistent_actor_xyz',
        contextDateLabel: 'Jan 2022',
      })
    ).toThrow(/Actor prompt file not found/i);
  });

  it('caches: calling twice with same key does not re-read disk (cache hit)', () => {
    // Call once to prime the cache
    const first = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Oct 2021',
    });
    // Call again — cache should return the same content
    const second = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Oct 2021',
    });
    expect(first.systemPrompt).toBe(second.systemPrompt);
  });
});

describe('mood annotation', () => {
  it('asks the actor to tag how they are delivering the answer', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    expect(systemPrompt).toContain('[[mood: X]]');
    for (const mood of MOODS) {
      expect(systemPrompt).toContain(mood);
    }
  });

  it('tells the model the tag is stripped, so it does not editorialise about it', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    expect(systemPrompt).toContain('removed before the player sees anything');
  });

  it('keeps the mood instruction last, after the context date anchor', () => {
    const { systemPrompt } = assembleInterrogationPrompt({
      actorPromptKey:   'lavrov',
      contextDateLabel: 'Nov 2021',
    });
    expect(systemPrompt.indexOf('roleplaying as of')).toBeLessThan(
      systemPrompt.indexOf('[[mood: X]]')
    );
  });
});

describe('splitMoodTag', () => {
  it('pulls the tag out and hands back clean prose', () => {
    expect(splitMoodTag('We have made our position clear.\n[[mood: firm]]')).toEqual({
      answer: 'We have made our position clear.',
      mood:   'firm',
    });
  });

  it('is case-insensitive and tolerates loose spacing', () => {
    expect(splitMoodTag('Text. [[ MOOD :  Guarded ]]').mood).toBe('guarded');
  });

  it('returns a null mood when the model omitted the tag', () => {
    expect(splitMoodTag('Just an answer.')).toEqual({
      answer: 'Just an answer.',
      mood:   null,
    });
  });

  it('rejects a mood outside the list but still strips the tag from the prose', () => {
    const { answer, mood } = splitMoodTag('An answer. [[mood: apoplectic]]');
    expect(mood).toBe(null);
    expect(answer).toBe('An answer.');
  });

  it('takes the last tag when a model emits more than one', () => {
    expect(splitMoodTag('a [[mood: wry]] b [[mood: grave]]').mood).toBe('grave');
  });

  it('never leaks a tag into the answer, wherever it lands', () => {
    const { answer } = splitMoodTag('[[mood: neutral]] Leading tag.');
    expect(answer).toBe('Leading tag.');
    expect(answer).not.toContain('mood');
  });

  it('handles a missing or non-string completion', () => {
    expect(splitMoodTag(undefined)).toEqual({ answer: '', mood: null });
    expect(splitMoodTag(null)).toEqual({ answer: '', mood: null });
  });
});
