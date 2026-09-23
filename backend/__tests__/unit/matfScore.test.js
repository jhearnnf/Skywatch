const { matfScore } = require('../../utils/matfScore');

describe('matfScore', () => {
  it('takes a point off per wrong answer', () => {
    expect(matfScore(24, 30)).toBe(18);
    expect(matfScore(20, 20)).toBe(20);
  });

  it('never goes below zero, so blind guessing scores nothing', () => {
    // Five options: mashing lands about 1 in 5.
    expect(matfScore(40, 200)).toBe(0);
    expect(matfScore(0, 0)).toBe(0);
  });

  it('treats missing values as zero', () => {
    expect(matfScore(undefined, undefined)).toBe(0);
    expect(matfScore(5, undefined)).toBe(5);
  });
});
