const router = require('express').Router();
const crypto = require('crypto');
const mongoose = require('mongoose');

const { protect, adminOnly } = require('../middleware/auth');
const BriefReel              = require('../models/BriefReel');
const IntelligenceBrief      = require('../models/IntelligenceBrief');
const AppSettings            = require('../models/AppSettings');
const { normalizeSections }  = require('../utils/descriptionSections');
const { generateBriefReelTimeline } = require('../services/briefReelAi');

// SHA-256 of the section body — drives cache invalidation when the body is
// edited. Headings deliberately don't participate (a heading-only edit
// shouldn't burn tokens on a regeneration).
function hashBody(body) {
  return crypto.createHash('sha256').update(body || '').digest('hex');
}

function readFlag(settings) {
  const m = settings.featureFlags;
  if (m && typeof m.get === 'function') return m.get('briefReel') || 'off';
  return (m && m.briefReel) || 'off';
}

// Resolve a (brief, sectionIndex) tuple to its canonical body + heading.
// 404s if the brief or section is missing.
async function loadSection(briefId, sectionIndex) {
  if (!mongoose.isValidObjectId(briefId)) {
    const err = new Error('Invalid briefId'); err.status = 400; throw err;
  }
  const idx = parseInt(sectionIndex, 10);
  if (!Number.isInteger(idx) || idx < 0) {
    const err = new Error('Invalid sectionIndex'); err.status = 400; throw err;
  }
  const brief = await IntelligenceBrief.findById(briefId).lean();
  if (!brief) { const err = new Error('Brief not found'); err.status = 404; throw err; }
  const sections = normalizeSections(brief.descriptionSections);
  if (idx >= sections.length) { const err = new Error('Section not found'); err.status = 404; throw err; }
  return { brief, section: sections[idx], sectionIndex: idx };
}

// ── Admin: review queue ─────────────────────────────────────────────────────
// GET /api/brief-reels/admin/pending  — pending reels with the brief title
// and section heading attached, for the admin review UI.
// NOTE: declared before `/:briefId/:sectionIndex` so Express matches the
// literal `/admin/...` segment first.
router.get('/admin/pending', protect, adminOnly, async (_req, res) => {
  try {
    const reels = await BriefReel
      .find({ status: 'pending' })
      .sort({ generatedAt: -1 })
      .populate('briefId', 'title slug')
      .lean();

    const rows = reels.map(r => ({
      _id:           r._id,
      briefId:       r.briefId?._id ?? r.briefId,
      briefTitle:    r.briefId?.title ?? '(unknown)',
      briefSlug:     r.briefId?.slug ?? null,
      sectionIndex:  r.sectionIndex,
      bodySnapshot:  r.bodySnapshot,
      generatedAt:   r.generatedAt,
      timeline:      r.timeline,
    }));

    res.json({ status: 'success', data: { rows } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: generate ─────────────────────────────────────────────────────────
// POST /api/brief-reels/admin/generate
// Body: { briefId, sectionIndex }
// Idempotent w.r.t. (briefId, sectionIndex, bodyHash): if any reel already
// exists for this body, returns it (published wins over pending).
router.post('/admin/generate', protect, adminOnly, async (req, res) => {
  try {
    const { briefId, sectionIndex } = req.body || {};
    const { brief, section, sectionIndex: idx } = await loadSection(briefId, sectionIndex);
    const bodyHash = hashBody(section.body);

    // Return early if we already have a reel for this exact body.
    const existing = await BriefReel
      .findOne({ briefId: brief._id, sectionIndex: idx, bodyHash })
      .sort({ status: -1 })
      .lean();
    if (existing) {
      return res.json({ status: 'success', data: { reel: existing, regenerated: false } });
    }

    let timeline;
    try {
      timeline = await generateBriefReelTimeline({
        briefTitle:     brief.title,
        sectionHeading: section.heading,
        sectionBody:    section.body,
      });
    } catch (err) {
      console.error('[BriefReel] generate failed:', err.message);
      return res.status(502).json({ message: `AI generation failed: ${err.message}` });
    }

    const reel = await BriefReel.create({
      briefId:      brief._id,
      sectionIndex: idx,
      bodyHash,
      bodySnapshot: section.body,
      status:       'pending',
      timeline,
      generatedBy:  req.user._id,
      generatedAt:  new Date(),
    });

    res.json({ status: 'success', data: { reel: reel.toObject(), regenerated: true } });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ── Admin: publish ──────────────────────────────────────────────────────────
// POST /api/brief-reels/admin/:id/publish
router.post('/admin/:id/publish', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel id' });
    }
    const reel = await BriefReel.findById(req.params.id);
    if (!reel) return res.status(404).json({ message: 'Reel not found' });

    reel.status      = 'published';
    reel.publishedBy = req.user._id;
    reel.publishedAt = new Date();
    await reel.save();

    res.json({ status: 'success', data: { reel: reel.toObject() } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: discard ──────────────────────────────────────────────────────────
// DELETE /api/brief-reels/admin/:id  — removes the cached reel. Next play
// triggers a fresh generation (admin must press the button to spend tokens).
router.delete('/admin/:id', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid reel id' });
    }
    const deleted = await BriefReel.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Reel not found' });
    res.json({ status: 'success', data: { id: deleted._id } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Public read ─────────────────────────────────────────────────────────────
// GET /api/brief-reels/:briefId/:sectionIndex
// Returns the currently-cached reel for this section. Users only see
// 'published' reels; admins also see 'pending' (so they can review a fresh
// generation before flipping the publish switch).
//
// Status codes:
//   200 → reel found (body: { status, timeline, _id })
//   204 → no reel cached yet for this body
//   403 → feature flag forbids access for this user
router.get('/:briefId/:sectionIndex', protect, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    const flag = readFlag(settings);
    if (flag === 'off') return res.status(403).json({ message: 'Feature disabled' });
    if (flag === 'admin' && !req.user.isAdmin) return res.status(403).json({ message: 'Admin only' });

    const { brief, section, sectionIndex } = await loadSection(req.params.briefId, req.params.sectionIndex);
    const bodyHash = hashBody(section.body);

    const filter = { briefId: brief._id, sectionIndex, bodyHash };
    if (!req.user.isAdmin) filter.status = 'published';

    // Admins may have both a 'pending' (newly generated) and a 'published'
    // (previously approved) reel for the exact same body. Prefer published.
    // String sort: 'published' > 'pending' alphabetically, so DESC wins.
    const reel = await BriefReel
      .findOne(filter)
      .sort({ status: -1 })
      .lean();

    if (!reel) return res.status(204).end();
    return res.json({
      status: 'success',
      data: {
        _id:        reel._id,
        status:     reel.status,
        timeline:   reel.timeline,
        generatedAt: reel.generatedAt,
        publishedAt: reel.publishedAt,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
