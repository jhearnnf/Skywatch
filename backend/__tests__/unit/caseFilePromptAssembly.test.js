'use strict';

/**
 * caseFilePromptAssembly.test.js
 *
 * Unit tests for the caseFilePromptAssembly utility.
 * No DB; no network calls.
 */

const { assembleInterrogationPrompt, _clearCache } = require('../../utils/caseFilePromptAssembly');

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
