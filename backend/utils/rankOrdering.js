/**
 * rankOrdering.js — Deterministic RAF rank ordering for Ranks-category leads.
 *
 * Source of truth: IntelLead.rankOrder (Number, 1 = most senior).
 * Mirror: IntelligenceBrief.gameData.rankHierarchyOrder (same value, copied
 *         to every brief whose title matches the lead).
 *
 * Unlike IntelLead.priorityNumber (subjective "learning order", AI-driven
 * via priorityRanking.js), rank order is objective military hierarchy and
 * is managed by these deterministic helpers.
 *
 * Concurrency note: the bulkWrites are NOT wrapped in a Mongo transaction
 * because the codebase doesn't require a replica set. The list is small
 * (~21 ranks) and edits are admin-only, so races are vanishingly rare. If
 * a duplicate or gap ever appears, `compactRankOrder()` is idempotent and
 * fixes it on the next run — exposed via the admin "Recompact" action.
 *
 * Lead-deletion hook: scripts that delete Ranks leads (cleanseRanksBriefs,
 * etc.) should call `removeRank(leadId)` first, or `compactRankOrder()`
 * afterwards, to keep the sequence gap-free.
 */

const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const CATEGORY = 'Ranks';

// Mirror a (title → rankOrder) map onto every matching IntelligenceBrief's
// gameData.rankHierarchyOrder. Uses bulkWrite + updateMany so multiple briefs
// sharing a title (re-creates, etc.) all stay in sync.
async function mirrorOrdersToBriefs(orderByTitle) {
  const briefOps = [];
  for (const [title, order] of orderByTitle) {
    briefOps.push({
      updateMany: {
        filter: { category: CATEGORY, title },
        update: order == null
          ? { $unset: { 'gameData.rankHierarchyOrder': '' } }
          : { $set:   { 'gameData.rankHierarchyOrder': order } },
      },
    });
  }
  if (briefOps.length) await IntelligenceBrief.bulkWrite(briefOps);
  return briefOps.length;
}

/**
 * Re-number every Ranks lead with a non-null rankOrder so the sequence is a
 * contiguous 1..N preserving current relative ordering. Leads with rankOrder
 * == null stay null — they are intentionally excluded from the seniority
 * sequence (e.g. commission-type concepts in Specialist Role).
 *
 * Mirrors the new values to briefs by title.
 *
 * Idempotent — safe to run any time. Used as the self-heal for any race
 * or partial write.
 *
 * Returns { leadsCompacted, briefsUpdated }.
 */
async function compactRankOrder() {
  const numbered = await IntelLead.find({ category: CATEGORY, rankOrder: { $ne: null } })
    .select('_id title rankOrder')
    .sort({ rankOrder: 1 })
    .lean();

  const leadOps = [];
  const orderByTitle = new Map();
  numbered.forEach((lead, i) => {
    const newOrder = i + 1;
    orderByTitle.set(lead.title, newOrder);
    if (lead.rankOrder !== newOrder) {
      leadOps.push({
        updateOne: {
          filter: { _id: lead._id },
          update: { $set: { rankOrder: newOrder } },
        },
      });
    }
  });

  if (leadOps.length) await IntelLead.bulkWrite(leadOps);
  const briefsUpdated = await mirrorOrdersToBriefs(orderByTitle);
  return { leadsCompacted: leadOps.length, briefsUpdated };
}

/**
 * Insert a lead at a specific rank slot, bumping every existing lead at or
 * above that slot by +1. The lead must already exist (its category is set
 * to Ranks elsewhere). If the lead currently has a rankOrder, this is
 * equivalent to setRankOrder() — call that instead.
 *
 * `targetOrder` is clamped to [1, N+1] where N is the current Ranks count
 * excluding this lead.
 */
async function insertRankAt(leadId, targetOrder) {
  const lead = await IntelLead.findById(leadId).select('_id category rankOrder');
  if (!lead || lead.category !== CATEGORY)
    throw new Error(`insertRankAt: lead ${leadId} is not in Ranks`);
  if (lead.rankOrder != null)
    throw new Error(`insertRankAt: lead ${leadId} already has rankOrder ${lead.rankOrder} — use setRankOrder`);

  const existing = await IntelLead.countDocuments({
    category: CATEGORY,
    rankOrder: { $ne: null },
    _id: { $ne: lead._id },
  });
  const slot = Math.max(1, Math.min(targetOrder | 0, existing + 1));

  // Bump everyone at or above the slot
  await IntelLead.updateMany(
    { category: CATEGORY, rankOrder: { $gte: slot }, _id: { $ne: lead._id } },
    { $inc: { rankOrder: 1 } },
  );
  await IntelLead.updateOne({ _id: lead._id }, { $set: { rankOrder: slot } });

  // Mirror everything to briefs (cheap — one updateMany per Ranks title)
  return rebuildMirror();
}

/**
 * Remove a lead from the rank sequence: shift everyone above it down by 1
 * and clear the lead's own rankOrder. Use this BEFORE physically deleting
 * the lead so the rest of the sequence stays gap-free.
 */
async function removeRank(leadId) {
  const lead = await IntelLead.findById(leadId).select('_id category rankOrder title');
  if (!lead || lead.category !== CATEGORY) return { leadsShifted: 0, briefsUpdated: 0 };
  const oldOrder = lead.rankOrder;
  if (oldOrder == null) return { leadsShifted: 0, briefsUpdated: 0 };

  await IntelLead.updateOne({ _id: lead._id }, { $set: { rankOrder: null } });
  const shifted = await IntelLead.updateMany(
    { category: CATEGORY, rankOrder: { $gt: oldOrder } },
    { $inc: { rankOrder: -1 } },
  );

  // Clear the brief mirror for the removed lead's title, then re-mirror the rest.
  await IntelligenceBrief.updateMany(
    { category: CATEGORY, title: lead.title },
    { $unset: { 'gameData.rankHierarchyOrder': '' } },
  );
  const briefsUpdated = await rebuildMirror();
  return { leadsShifted: shifted.modifiedCount ?? 0, briefsUpdated };
}

/**
 * Move a lead to a new slot. If it had no slot, this is `insertRankAt`.
 * If it did, we close its old gap first and then insert at the new slot.
 */
async function setRankOrder(leadId, newOrder) {
  const lead = await IntelLead.findById(leadId).select('_id category rankOrder');
  if (!lead || lead.category !== CATEGORY)
    throw new Error(`setRankOrder: lead ${leadId} is not in Ranks`);

  if (lead.rankOrder == null) return insertRankAt(leadId, newOrder);
  if (lead.rankOrder === newOrder) return rebuildMirror().then(b => ({ briefsUpdated: b }));

  await removeRank(leadId);
  return insertRankAt(leadId, newOrder);
}

/**
 * Append a lead at the bottom of the rank sequence (max + 1). Used when a
 * brief/lead first enters the Ranks category and the admin hasn't picked a
 * slot yet — they can then drag/edit it into place via setRankOrder.
 */
async function appendRank(leadId) {
  const lead = await IntelLead.findById(leadId).select('_id category rankOrder');
  if (!lead || lead.category !== CATEGORY)
    throw new Error(`appendRank: lead ${leadId} is not in Ranks`);
  if (lead.rankOrder != null) return { briefsUpdated: 0 };

  const max = await IntelLead.find({ category: CATEGORY, rankOrder: { $ne: null } })
    .sort({ rankOrder: -1 })
    .limit(1)
    .select('rankOrder')
    .lean();
  const next = (max[0]?.rankOrder ?? 0) + 1;
  await IntelLead.updateOne({ _id: lead._id }, { $set: { rankOrder: next } });
  return rebuildMirror().then(b => ({ briefsUpdated: b, rankOrder: next }));
}

// Walk every numbered Ranks lead and re-mirror its rankOrder to all matching briefs.
async function rebuildMirror() {
  const leads = await IntelLead.find({ category: CATEGORY, rankOrder: { $ne: null } })
    .select('title rankOrder')
    .lean();
  const orderByTitle = new Map(leads.map(l => [l.title, l.rankOrder]));
  return mirrorOrdersToBriefs(orderByTitle);
}

module.exports = {
  compactRankOrder,
  insertRankAt,
  removeRank,
  setRankOrder,
  appendRank,
};
