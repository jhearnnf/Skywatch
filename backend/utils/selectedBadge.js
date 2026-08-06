const IntelligenceBrief = require('../models/IntelligenceBrief');

// Resolve a user's selectedBadgeBriefId into { briefId, title, cutoutUrl } or
// null. Returns null if the brief was deleted, is no longer an Aircrafts brief,
// or the cutout was removed since the selection was made — the frontend then
// falls back to the rank badge, and the stale id stays harmless on the User doc.
async function resolveSelectedBadge(briefId) {
  if (!briefId) return null;
  const brief = await IntelligenceBrief.findById(briefId)
    .select('title category status media')
    .populate('media')
    .lean();
  if (!brief || brief.category !== 'Aircrafts' || brief.status !== 'published') return null;
  const cutoutMedia = (brief.media || []).find(m => m.cutoutUrl);
  if (!cutoutMedia) return null;
  return { briefId: brief._id, title: brief.title, cutoutUrl: cutoutMedia.cutoutUrl };
}

// Attach selectedBadge to a user object (toObject()'d or lean). Mutates and
// returns the object so callers can chain.
async function withSelectedBadge(userObj) {
  userObj.selectedBadge = await resolveSelectedBadge(userObj.selectedBadgeBriefId);
  return userObj;
}

// Batch form of resolveSelectedBadge, for surfaces that render many users at
// once — a chat thread can easily hold twenty distinct senders, and calling the
// single-brief version per user would fire twenty queries for what is usually
// a handful of distinct aircraft.
//
// Returns Map<briefIdString, badge|null> covering every id passed in.
async function resolveSelectedBadges(briefIds = []) {
  const ids = [...new Set(briefIds.filter(Boolean).map(String))];
  const out = new Map();
  if (!ids.length) return out;

  const briefs = await IntelligenceBrief.find({ _id: { $in: ids } })
    .select('title category status media')
    .populate('media')
    .lean();

  for (const brief of briefs) {
    if (brief.category !== 'Aircrafts' || brief.status !== 'published') continue;
    const cutoutMedia = (brief.media || []).find(m => m.cutoutUrl);
    if (!cutoutMedia) continue;
    out.set(String(brief._id), {
      briefId:   brief._id,
      title:     brief.title,
      cutoutUrl: cutoutMedia.cutoutUrl,
    });
  }
  return out;
}

module.exports = { resolveSelectedBadge, resolveSelectedBadges, withSelectedBadge };
