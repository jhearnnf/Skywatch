'use strict';

/**
 * caseFileScoring.js
 *
 * Pure-function scorer for Case Files chapters.
 * No DB, no model imports, no I/O.
 */

// ── Stage weights ─────────────────────────────────────────────────────────────

const BASE_SCORE = 1000;

const STAGE_WEIGHTS = {
  evidence_wall:        0.25,
  map_predictive:       0.15,
  actor_interrogations: 0.10,
  decision_point:       0.25,
  phase_reveal:         0.05,
  map_live:             0.20,
  cold_open:            0.00,
  debrief:              0.00,
};

// Forgiveness: any stage the player actually attempted floors at this fraction
// of its maxScore. Keeps a confused first-time player feeling progress so they
// stay engaged with the debrief.
const STAGE_SCORE_FLOOR_RATIO = 0.30;

// Penalty for an evidence-wall connection that doesn't match a valid pair.
// Kept low so exploratory linking is encouraged, not punished.
const EVIDENCE_WALL_NOISE_PENALTY_RATIO = 0.01;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the effective maxScore for a stage.
 * Respects an explicit scoring.maxScore override; otherwise uses weight × 1000.
 */
function resolveMaxScore(stage) {
  if (stage.scoring && stage.scoring.maxScore != null) {
    return stage.scoring.maxScore;
  }
  const weight = STAGE_WEIGHTS[stage.type];
  if (weight == null) return 0;
  return weight * BASE_SCORE;
}

/**
 * Returns true if the unordered pair [a,b] is present in pairsArray,
 * where each element of pairsArray is [x,y].
 */
function pairExists(pairsArray, a, b) {
  return pairsArray.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

// ── Per-stage scorers ─────────────────────────────────────────────────────────

function scoreColdOpen() {
  return { score: 0, notes: 'Cold open — no score' };
}

function scoreDebrief() {
  return { score: 0, notes: 'Debrief — no score' };
}

function scoreEvidenceWall(stage, result) {
  const maxScore          = resolveMaxScore(stage);
  const validPairs        = stage.scoring.validConnectionPairs || [];   // [[id,id], ...]
  const signalWeights     = stage.scoring.signalWeights || {};
  const connections       = result.payload.connections || [];           // [{fromItemId, toItemId}]
  const pairCount         = validPairs.length;

  if (maxScore === 0 || pairCount === 0) {
    return { score: 0, notes: 'Evidence wall — no valid pairs defined' };
  }

  let raw  = 0;
  let hits = 0;
  let noise = 0;

  for (const conn of connections) {
    const { fromItemId: a, toItemId: b } = conn;
    if (pairExists(validPairs, a, b)) {
      const wa = signalWeights[a] != null ? signalWeights[a] : 1;
      const wb = signalWeights[b] != null ? signalWeights[b] : 1;
      raw += ((wa + wb) / 2) * (maxScore / pairCount);
      hits++;
    } else {
      noise++;
    }
  }

  const penalty = noise * EVIDENCE_WALL_NOISE_PENALTY_RATIO * maxScore;
  const score   = Math.max(0, Math.min(maxScore, Math.round(raw - penalty)));

  const notes = `${hits} of ${pairCount} valid connection${pairCount !== 1 ? 's' : ''}` +
    (noise > 0 ? `, ${noise} noise` : '');

  return { score, notes };
}

function scoreMapPredictive(stage, result) {
  const maxScore    = resolveMaxScore(stage);
  const correctAxes = stage.scoring.correctAxes || [];  // [{fromHotspotId, toHotspotId, isMain}]
  const axes        = result.payload.axes || [];         // [{fromHotspotId, toHotspotId, markedAsMain}]

  if (maxScore === 0 || correctAxes.length === 0) {
    return { score: 0, notes: 'Map predictive — no correct axes defined' };
  }

  const perAxis    = maxScore / correctAxes.length;
  let raw          = 0;
  let hits         = 0;
  let bonusApplied = false;

  for (const submitted of axes) {
    const match = correctAxes.find(
      ca => ca.fromHotspotId === submitted.fromHotspotId &&
            ca.toHotspotId   === submitted.toHotspotId,
    );
    if (match) {
      let award = perAxis;
      if (match.isMain && submitted.markedAsMain) {
        award *= 1.2;
        bonusApplied = true;
      }
      raw += award;
      hits++;
    }
  }

  const score = Math.min(maxScore, Math.round(raw));
  const notes = `${hits} of ${correctAxes.length} correct axis${correctAxes.length !== 1 ? 'es' : ''}` +
    (bonusApplied ? ', main-effort bonus applied' : '');

  return { score, notes };
}

function scoreActorInterrogations(stage, result) {
  const maxScore           = resolveMaxScore(stage);
  const baseEngagement     = stage.scoring.baseEngagementScore || 0;
  const interrogations     = result.payload.interrogations || []; // [{actorId, questionCount}]

  // Distinct actors with at least 1 question
  const distinctActors = new Set(
    interrogations
      .filter(i => i.questionCount >= 1)
      .map(i => i.actorId),
  ).size;

  const score = Math.min(maxScore, Math.round(baseEngagement * distinctActors));
  const notes = `${distinctActors} actor${distinctActors !== 1 ? 's' : ''} interrogated`;

  return { score, notes };
}

/**
 * decision_point scorer.
 * Needs access to earlier evidence_wall stageResults to compute consistency multiplier.
 */
function scoreDecisionPoint(stage, result, allResults) {
  const maxScore            = resolveMaxScore(stage);
  const optionRealityScores = stage.scoring.optionRealityScores || {};
  const optionSupportingIds = stage.scoring.optionSupportingEvidenceIds || {};
  const selectedOptionId    = result.payload.selectedOptionId;

  const realityPct = optionRealityScores[selectedOptionId] ?? 0;
  const base       = (realityPct / 100) * maxScore;

  // Find earlier evidence_wall connections from allResults
  const ewResult = allResults.find(r => r.stageType === 'evidence_wall');
  const connectedIds = new Set();
  if (ewResult && ewResult.payload.connections) {
    for (const conn of ewResult.payload.connections) {
      connectedIds.add(conn.fromItemId);
      connectedIds.add(conn.toItemId);
    }
  }

  const supportingIds = optionSupportingIds[selectedOptionId] || [];
  let consistencyMultiplier;

  if (supportingIds.length === 0) {
    consistencyMultiplier = 1.0;
  } else {
    const connected = supportingIds.filter(id => connectedIds.has(id)).length;
    consistencyMultiplier = Math.min(1.5, 1.0 + 0.5 * (connected / supportingIds.length));
  }

  const score = Math.min(maxScore, Math.round(base * consistencyMultiplier));

  const realityLabel = `${realityPct}% reality`;
  const multLabel    = `consistency ×${consistencyMultiplier.toFixed(2)}`;
  const notes        = `Option ${selectedOptionId}: ${realityLabel}, ${multLabel}`;

  return { score, notes };
}

/**
 * phase_reveal scorer.
 * Re-scores updated connections against original valid pairs + confirmed resolutions.
 * Awards only the delta over the original evidence_wall score.
 */
function scorePhaseReveal(stage, result, allResults) {
  const maxScore   = resolveMaxScore(stage);
  const validPairs = (stage.scoring.validConnectionPairs || []).slice(); // shallow copy
  const resolutions = stage.scoring.connectionResolutions || [];

  // Expand valid pairs with confirmed resolution pairs
  for (const res of resolutions) {
    if (res.verdict === 'confirmed' && res.pairItemIds) {
      const [a, b] = res.pairItemIds;
      if (!pairExists(validPairs, a, b)) {
        validPairs.push([a, b]);
      }
    }
  }

  const signalWeights = stage.scoring.signalWeights || {};
  const pairCount     = validPairs.length;

  // Original evidence_wall connections
  const ewResult          = allResults.find(r => r.stageType === 'evidence_wall');
  const originalConns     = (ewResult && ewResult.payload.connections) ? ewResult.payload.connections : [];
  const updatedConns      = result.payload.updatedConnections || [];

  // Find NEW connections (in updated but not in original)
  function connKey(a, b) { return [a, b].sort().join('|'); }
  const originalKeys = new Set(originalConns.map(c => connKey(c.fromItemId, c.toItemId)));
  const newConns     = updatedConns.filter(c => !originalKeys.has(connKey(c.fromItemId, c.toItemId)));

  if (pairCount === 0) {
    return { score: 0, notes: 'Phase reveal — no valid pairs defined' };
  }

  let delta = 0;
  let hits  = 0;
  for (const conn of newConns) {
    const { fromItemId: a, toItemId: b } = conn;
    if (pairExists(validPairs, a, b)) {
      const wa = signalWeights[a] != null ? signalWeights[a] : 1;
      const wb = signalWeights[b] != null ? signalWeights[b] : 1;
      delta += ((wa + wb) / 2) * (maxScore / pairCount);
      hits++;
    }
  }

  const score = Math.min(maxScore, Math.round(delta));
  const notes = `${hits} new valid connection${hits !== 1 ? 's' : ''} after reveal`;

  return { score, notes };
}

function scoreMapLive(stage, result) {
  const stageMax           = resolveMaxScore(stage);
  const subDecisionAnswers = stage.scoring.subDecisionAnswers || {};
  const submitted          = result.payload.subDecisions || [];
  const submittedById      = new Map(submitted.map(s => [s.subDecisionId, s]));

  const definedIds = Object.keys(subDecisionAnswers);
  if (definedIds.length === 0) {
    return { score: 0, notes: 'Map live — no sub-decisions defined' };
  }

  const fallbackPerSub = stageMax / definedIds.length;
  let earned  = 0;
  let correct = 0;

  for (const id of definedIds) {
    const answer = subDecisionAnswers[id];
    const sub    = submittedById.get(id);
    if (!sub) continue;

    const correctSet  = new Set(answer.correctOptionIds || []);
    const selectedSet = new Set(sub.selectedOptionIds || []);

    // Sets must be equal (same size, every element of selected in correct and vice-versa)
    const equal =
      correctSet.size === selectedSet.size &&
      [...selectedSet].every(opt => correctSet.has(opt));

    if (equal) {
      const subMax = typeof answer.maxScore === 'number' ? answer.maxScore : fallbackPerSub;
      earned += subMax;
      correct++;
    }
  }

  const score = Math.min(stageMax, Math.round(earned));
  const notes = `${correct} of ${definedIds.length} sub-decision${definedIds.length !== 1 ? 's' : ''} correct`;

  return { score, notes };
}

// ── Main scorer ───────────────────────────────────────────────────────────────

/**
 * Score a completed chapter.
 *
 * @param {Object}   chapter      - plain chapter object with .stages[]
 * @param {Object[]} stageResults - [{stageIndex, stageType, payload}]
 * @returns {{ totalScore, breakdown }}
 */
function scoreChapter(chapter, stageResults) {
  const stages       = chapter.stages || [];
  const resultsByIdx = new Map((stageResults || []).map(r => [r.stageIndex, r]));

  const breakdown = [];

  for (let i = 0; i < stages.length; i++) {
    const stage    = stages[i];
    const maxScore = resolveMaxScore(stage);
    const result   = resultsByIdx.get(i);

    if (!result) {
      breakdown.push({
        stageIndex: i,
        stageType:  stage.type,
        score:      0,
        maxScore,
        notes:      'Not submitted',
      });
      continue;
    }

    // Validate stageType consistency
    if (!STAGE_WEIGHTS.hasOwnProperty(stage.type)) {
      breakdown.push({
        stageIndex: i,
        stageType:  stage.type,
        score:      0,
        maxScore,
        notes:      'Unknown stage type',
      });
      continue;
    }

    let scored;
    switch (stage.type) {
      case 'cold_open':
        scored = scoreColdOpen();
        break;
      case 'debrief':
        scored = scoreDebrief();
        break;
      case 'evidence_wall':
        scored = scoreEvidenceWall(stage, result);
        break;
      case 'map_predictive':
        scored = scoreMapPredictive(stage, result);
        break;
      case 'actor_interrogations':
        scored = scoreActorInterrogations(stage, result);
        break;
      case 'decision_point':
        scored = scoreDecisionPoint(stage, result, stageResults);
        break;
      case 'phase_reveal':
        scored = scorePhaseReveal(stage, result, stageResults);
        break;
      case 'map_live':
        scored = scoreMapLive(stage, result);
        break;
      default:
        scored = { score: 0, notes: 'Unknown stage type' };
    }

    // Apply forgiveness floor so a confused player still feels progress, then
    // clamp to [0, maxScore]. The floor only kicks in when the stage has a
    // non-zero maxScore (cold_open/debrief stay at 0).
    const flooredScore = maxScore > 0
      ? Math.max(scored.score, Math.round(STAGE_SCORE_FLOOR_RATIO * maxScore))
      : scored.score;
    const finalScore = Math.max(0, Math.min(maxScore, flooredScore));

    breakdown.push({
      stageIndex: i,
      stageType:  stage.type,
      score:      finalScore,
      maxScore,
      notes:      scored.notes,
    });
  }

  const totalScore = Math.round(breakdown.reduce((sum, b) => sum + b.score, 0));

  return { totalScore, breakdown };
}

module.exports = { scoreChapter };
