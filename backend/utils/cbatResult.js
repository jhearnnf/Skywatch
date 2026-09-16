// Shared persistence helper for CBAT score submissions.
//
// Adds three fields every result row carries without changing any individual
// game schema file:
//   • playedAt  — an ISO timestamp the client stamps when the game actually
//                 finished. Replayed (queued-while-offline) scores would
//                 otherwise be dated at sync time. CBAT result schemas use a
//                 manual `createdAt: { default: Date.now }` (not Mongoose
//                 `timestamps`), so we can set createdAt directly.
//   • clientResultId — a per-session UUID. The outbox may retry a flush after
//                 the server already committed the insert (response lost on a
//                 dropped connection). Deduping on this id makes submission
//                 idempotent so a retry never creates a phantom second score.
//   • uiTheme   — which site theme the run was played under (see
//                 constants/cbatUiThemes.js). Every board shows it per row so
//                 a SkyWatch score and a Real CBAT score can be told apart at
//                 a glance. The client stamps it at game end (lib/cbatOutbox.js),
//                 so a queued score keeps the theme it was actually played in.
//
// Anti-cheat is deliberately light here: scores are already client-trusted, so
// we only guard against accidental duplicates, not deliberate fakes.

const { CBAT_GAMES } = require('../constants/cbatGames');
const { UI_THEMES, normalizeUiTheme } = require('../constants/cbatUiThemes');
const { announceCbatMedal } = require('./medals');

let pathsEnsured = false;

// Add the optional `clientResultId` and `uiTheme` paths to every distinct CBAT
// result model. Called once at startup; the guard makes repeat calls a no-op.
function ensureCbatResultPaths() {
  if (pathsEnsured) return;
  const seen = new Set();
  for (const cfg of Object.values(CBAT_GAMES)) {
    const Model = cfg.Model;
    if (!Model || seen.has(Model.modelName)) continue;
    seen.add(Model.modelName);
    if (!Model.schema.path('clientResultId')) {
      Model.schema.add({ clientResultId: { type: String, default: null } });
      // Sparse so the many null rows don't bloat the index. Used by the dedupe
      // lookup below; safe if autoIndex is off in prod (findOne falls back to
      // the existing userId index prefix).
      Model.schema.index({ userId: 1, clientResultId: 1 }, { sparse: true });
    }
    // Null for scores that predate the field, or that arrived without one. A
    // few schemas (Symbols, Code Duplicates, CUT) declare it themselves from
    // when only they recorded it; the guard leaves those alone.
    if (!Model.schema.path('uiTheme')) {
      Model.schema.add({ uiTheme: { type: String, enum: [...UI_THEMES, null], default: null } });
    }
  }
  pathsEnsured = true;
}

// Persist a CBAT result with offline-sync support.
//   Model       — the result model for this game
//   req         — express request (uses req.user._id + req.body.{playedAt,clientResultId})
//   fields      — already-validated/transformed game fields to store; a
//                 `uiTheme` here wins over the one read from the body
//   extraFilter — extra match for the dedupe lookup on shared-collection games
//                 (e.g. plane-turn 2d/3d share a model; pass { mode })
async function saveCbatResult(Model, req, fields, extraFilter = {}) {
  ensureCbatResultPaths();
  const { clientResultId, playedAt, uiTheme } = req.body || {};

  if (clientResultId) {
    const existing = await Model.findOne({
      userId: req.user._id,
      clientResultId,
      ...extraFilter,
    });
    if (existing) return existing; // idempotent — a retried flush is a no-op
  }

  const doc = { userId: req.user._id, uiTheme: normalizeUiTheme(uiTheme), ...fields };
  if (clientResultId) doc.clientResultId = clientResultId;
  if (playedAt) {
    const d = new Date(playedAt);
    if (!Number.isNaN(d.getTime())) doc.createdAt = d;
  }
  const created = await Model.create(doc);

  // Medal announcement. Deliberately below the dedupe short-circuit above, so a
  // retried offline flush that resolves to an existing row never announces the
  // same medal twice. Fire-and-forget with its own catch: a problem posting the
  // announcement must not fail the submission or delay the response.
  announceCbatMedal(Model, created.toObject ? created.toObject() : created).catch(() => {});

  return created;
}

module.exports = { ensureCbatResultPaths, saveCbatResult };
