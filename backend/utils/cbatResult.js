// Shared persistence helper for CBAT score submissions.
//
// Adds two pieces of offline-sync support without changing any individual game
// schema file:
//   • playedAt  — an ISO timestamp the client stamps when the game actually
//                 finished. Replayed (queued-while-offline) scores would
//                 otherwise be dated at sync time. CBAT result schemas use a
//                 manual `createdAt: { default: Date.now }` (not Mongoose
//                 `timestamps`), so we can set createdAt directly.
//   • clientResultId — a per-session UUID. The outbox may retry a flush after
//                 the server already committed the insert (response lost on a
//                 dropped connection). Deduping on this id makes submission
//                 idempotent so a retry never creates a phantom second score.
//
// Anti-cheat is deliberately light here: scores are already client-trusted, so
// we only guard against accidental duplicates, not deliberate fakes.

const { CBAT_GAMES } = require('../constants/cbatGames');

let pathsEnsured = false;

// Add the optional `clientResultId` path to every distinct CBAT result model.
// Called once at startup; the guard makes repeat calls a no-op.
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
  }
  pathsEnsured = true;
}

// Persist a CBAT result with offline-sync support.
//   Model       — the result model for this game
//   req         — express request (uses req.user._id + req.body.{playedAt,clientResultId})
//   fields      — already-validated/transformed game fields to store
//   extraFilter — extra match for the dedupe lookup on shared-collection games
//                 (e.g. plane-turn 2d/3d share a model; pass { mode })
async function saveCbatResult(Model, req, fields, extraFilter = {}) {
  ensureCbatResultPaths();
  const { clientResultId, playedAt } = req.body || {};

  if (clientResultId) {
    const existing = await Model.findOne({
      userId: req.user._id,
      clientResultId,
      ...extraFilter,
    });
    if (existing) return existing; // idempotent — a retried flush is a no-op
  }

  const doc = { userId: req.user._id, ...fields };
  if (clientResultId) doc.clientResultId = clientResultId;
  if (playedAt) {
    const d = new Date(playedAt);
    if (!Number.isNaN(d.getTime())) doc.createdAt = d;
  }
  return Model.create(doc);
}

module.exports = { ensureCbatResultPaths, saveCbatResult };
