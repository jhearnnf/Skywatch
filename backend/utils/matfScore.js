// Table Reading Test (MATF) score: one point per right answer, one off per
// wrong answer, never below zero.
//
// The test is speeded with five options per item, so while a wrong answer was
// free, mashing the buttons was the best strategy: about 1 in 5 lands, at
// whatever speed you can click. With a point off per miss, blind guessing
// loses about 0.6 a click, and a careful player barely notices the rule.
//
// Mirrored in src/utils/cbat/matfDifficulty.js (matfScore). Change both.
function matfScore(correctCount, attempted) {
  const correct = Number(correctCount) || 0;
  const wrong = Math.max(0, (Number(attempted) || 0) - correct);
  return Math.max(0, correct - wrong);
}

module.exports = { matfScore };
