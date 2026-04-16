/**
 * Unit tests for buildTitleRejectCheck — the predicate the keyword extractor
 * uses to reject keywords that point back at the brief itself (title,
 * subtitle, nickname, or the expanded form of an acronym title).
 */

const { buildTitleRejectCheck } = require('../../utils/keywordLinking');

describe('buildTitleRejectCheck', () => {
  describe('acronym expansion', () => {
    test('rejects expanded form of an acronym title (the JTAC bug)', () => {
      const reject = buildTitleRejectCheck({ title: 'JTAC' });
      expect(reject('joint terminal attack controllers')).toBe(true);
      expect(reject('Joint Terminal Attack Controllers')).toBe(true);
    });

    test('rejects acronym expansion stored as subtitle even without acronym detection', () => {
      const reject = buildTitleRejectCheck({
        title:    'JTAC',
        subtitle: 'Joint Terminal Attack Controllers',
      });
      expect(reject('joint terminal attack controllers')).toBe(true);
    });

    test('rejects expansion of an acronym nickname', () => {
      const reject = buildTitleRejectCheck({
        title:    'UK Quick Reaction Alert (North)',
        nickname: 'QRA',
      });
      expect(reject('quick reaction alert')).toBe(true);
    });

    test('does not treat non-acronym titles as acronyms', () => {
      const reject = buildTitleRejectCheck({ title: 'Typhoon' });
      expect(reject('tactical yankee personnel')).toBe(false);
    });
  });

  describe('title / nickname substring match (preserves old behaviour)', () => {
    test('rejects exact lowercase title match', () => {
      const reject = buildTitleRejectCheck({ title: 'JTAC' });
      expect(reject('jtac')).toBe(true);
      expect(reject('JTAC')).toBe(true);
    });

    test('rejects keyword that contains the title as substring', () => {
      const reject = buildTitleRejectCheck({ title: 'Lossiemouth' });
      expect(reject('RAF Lossiemouth')).toBe(true);
    });

    test('rejects keyword that is substring of title', () => {
      const reject = buildTitleRejectCheck({ title: 'RAF Lossiemouth' });
      expect(reject('Lossiemouth')).toBe(true);
    });

    test('rejects keyword matching nickname', () => {
      const reject = buildTitleRejectCheck({
        title:    'Eurofighter',
        nickname: 'Typhoon',
      });
      expect(reject('typhoon')).toBe(true);
    });
  });

  describe('subtitle handling', () => {
    test('rejects keyword exactly equal to subtitle (normalised)', () => {
      const reject = buildTitleRejectCheck({
        title:    'JTAC',
        subtitle: 'Joint Terminal Attack Controllers',
      });
      expect(reject('joint, terminal attack controllers')).toBe(true);
    });

    test('does NOT reject keyword that is merely a substring of a long subtitle', () => {
      const reject = buildTitleRejectCheck({
        title:    'Close Air Support',
        subtitle: 'Air-delivered fires in support of ground forces, coordinated by JTACs.',
      });
      expect(reject('ground forces')).toBe(false);
      expect(reject('JTACs')).toBe(false);
    });
  });

  describe('negative cases', () => {
    test('accepts unrelated keywords', () => {
      const reject = buildTitleRejectCheck({
        title:    'JTAC',
        subtitle: 'Joint Terminal Attack Controllers',
      });
      expect(reject('Typhoon FGR4')).toBe(false);
      expect(reject('No. 617 Squadron')).toBe(false);
      expect(reject('close air support')).toBe(false);
    });

    test('handles missing/empty inputs gracefully', () => {
      const reject = buildTitleRejectCheck({});
      expect(reject('anything')).toBe(false);
      expect(reject('')).toBe(false);
      expect(reject(undefined)).toBe(false);
    });

    test('does not reject single-word keywords under acronym rule', () => {
      const reject = buildTitleRejectCheck({ title: 'JTAC' });
      expect(reject('joint')).toBe(false);
    });
  });
});
