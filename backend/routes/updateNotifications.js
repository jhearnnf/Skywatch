const router = require('express').Router();
const { protect } = require('../middleware/auth');
const UpdateNotification = require('../models/UpdateNotification');

// All endpoints require an authenticated user.
router.use(protect);

// "Apply to existing users only" gate. Cutoff per notification = validFrom if
// set, else createdAt (frozen at save time). A user qualifies when their
// account existed at or before that cutoff. Split-OR avoids $expr so the
// indexed query path stays simple.
function existingOnlyClause(user) {
  const userCreatedAt = user?.createdAt ?? new Date(0);
  return {
    $or: [
      { applyToExistingOnly: { $ne: true } },
      { applyToExistingOnly: true, validFrom: { $ne: null, $gte: userCreatedAt } },
      { applyToExistingOnly: true, validFrom: null, createdAt: { $gte: userCreatedAt } },
    ],
  };
}

// GET /api/update-notifications/current?path=<pathname>
// Returns the single newest active notification matching this path's scope,
// but only if the current user has NOT already seen it. There is intentionally
// no fallback to older unseen notifications — per spec, "only the last added
// update notification will ever be shown" so that users who've been away don't
// have to click through a backlog. Older ones are reachable only via the
// modal's Previous/Next browser (see /history).
//
// Scope: a notification with empty targetPath matches any path; a non-empty
// targetPath matches only when it equals req.query.path.
router.get('/current', async (req, res) => {
  try {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    const userId = req.user._id;

    const active = UpdateNotification.activeFilter();
    const filter = {
      ...active,
      $and: [
        ...(active.$and || []),
        { $or: [{ targetPath: '' }, { targetPath: path }] },
        existingOnlyClause(req.user),
      ],
    };

    const doc = await UpdateNotification
      .findOne(filter)
      .sort({ createdAt: -1 })
      .lean();

    if (!doc) {
      return res.json({ status: 'success', data: { notification: null } });
    }

    const seen = (doc.viewedBy || []).some(v => String(v.userId) === String(userId));
    if (seen) {
      return res.json({ status: 'success', data: { notification: null } });
    }

    delete doc.viewedBy;
    res.json({ status: 'success', data: { notification: doc } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/update-notifications/history
// All currently-active notifications, newest first. Used by the modal's
// Previous/Next browser. Excludes viewedBy to keep the payload small and to
// avoid leaking other users' view records.
router.get('/history', async (req, res) => {
  try {
    const active = UpdateNotification.activeFilter();
    const filter = {
      ...active,
      $and: [
        ...(active.$and || []),
        existingOnlyClause(req.user),
      ],
    };
    const docs = await UpdateNotification
      .find(filter, { viewedBy: 0 })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ status: 'success', data: { notifications: docs } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/update-notifications/:id/acknowledge
// Marks this notification as seen by the current user. Idempotent — repeat
// calls do not duplicate viewedBy entries, but they DO update the response if
// the user submitted one (so a user who typed something after their first ack
// isn't silently dropped). Returns 200 whether or not the doc still matches
// (e.g. disabled mid-session); the modal only cares that the dismiss succeeded.
//
// Body: { response?: string } — only stored when the notification has
// responsesEnabled === true. Trimmed; empty strings are normalized to ''.
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const doc = await UpdateNotification.findById(id);
    if (!doc) return res.status(404).json({ status: 'error', message: 'Not found' });

    const rawResponse = typeof req.body?.response === 'string' ? req.body.response.trim() : '';
    const response = doc.responsesEnabled ? rawResponse.slice(0, 2000) : '';

    const existing = doc.viewedBy.find(v => String(v.userId) === String(userId));
    if (existing) {
      // Only overwrite an existing response if the new one is non-empty —
      // a user who already typed something shouldn't lose it by re-ack-ing.
      if (response) existing.response = response;
    } else {
      doc.viewedBy.push({ userId, viewedAt: new Date(), response });
    }
    await doc.save();

    res.json({ status: 'success', data: { acknowledged: true } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
