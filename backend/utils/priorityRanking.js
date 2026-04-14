const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const SystemLog         = require('../models/SystemLog');

const MAX_ATTEMPTS = 3;

// Incremental placement is used once a category has enough already-ranked
// leads that a full re-rank would be wasteful (and risk AI truncation), and
// only when the number of new titles to place is small relative to that.
const INCREMENTAL_MIN_RANKED   = 20;
const INCREMENTAL_MAX_TO_PLACE = 10;

/**
 * Validate a full-rerank AI rankings array against the supplied lead list.
 * Returns null on success, or a string describing the first failure found.
 */
function validateRankings(rankings, suppliedTitles) {
  const N = suppliedTitles.length;
  const suppliedSet = new Set(suppliedTitles.map(t => t.toLowerCase()));

  if (!Array.isArray(rankings))
    return 'Response "rankings" is not an array';

  if (rankings.length !== N)
    return `Expected ${N} items, got ${rankings.length}`;

  const seenTitles     = new Set();
  const seenPriorities = new Set();

  for (const item of rankings) {
    const titleLower = (item.title ?? '').toLowerCase().trim();

    if (!suppliedSet.has(titleLower))
      return `Unknown title in response: "${item.title}"`;

    if (seenTitles.has(titleLower))
      return `Duplicate title in response: "${item.title}"`;
    seenTitles.add(titleLower);

    const p = item.priority;
    if (!Number.isInteger(p) || p < 1)
      return `Invalid priority for "${item.title}": ${JSON.stringify(p)} (must be a positive integer)`;

    if (seenPriorities.has(p))
      return `Duplicate priority number ${p}`;
    seenPriorities.add(p);
  }

  for (let i = 1; i <= N; i++) {
    if (!seenPriorities.has(i))
      return `Priority sequence has a gap — ${i} is missing`;
  }

  return null;
}

/**
 * Validate an incremental-placement AI response.
 * The AI should return exactly one placement per title in `toPlace`, each
 * with a priority in [1, N] where N = existing ranked + new to place.
 */
function validatePlacements(placements, toPlace, N) {
  if (!Array.isArray(placements))
    return 'Response "placements" is not an array';

  if (placements.length !== toPlace.length)
    return `Expected ${toPlace.length} placements, got ${placements.length}`;

  const toPlaceSet = new Set(toPlace.map(t => t.toLowerCase().trim()));
  const seen       = new Set();

  for (const p of placements) {
    const titleLower = (p.title ?? '').toLowerCase().trim();

    if (!toPlaceSet.has(titleLower))
      return `Unknown placement title: "${p.title}"`;

    if (seen.has(titleLower))
      return `Duplicate placement title: "${p.title}"`;
    seen.add(titleLower);

    if (!Number.isInteger(p.priority) || p.priority < 1 || p.priority > N)
      return `Invalid priority for "${p.title}": ${JSON.stringify(p.priority)} (must be 1..${N})`;
  }

  return null;
}

async function logDuplicates(category, duplicates, sourceBriefId, sourceBriefTitle) {
  if (!duplicates || duplicates.length === 0) return;
  console.warn(`[reprioritizeCategory] "${category}" — AI detected ${duplicates.length} potential duplicate(s):`);
  for (const d of duplicates) {
    console.warn(`  ⚠ DUPLICATE: keep "${d.keep}", remove "${d.remove}" — ${d.reason}`);
  }
  try {
    await SystemLog.create({
      type:             'duplicate_leads_detected',
      category,
      duplicates,
      sourceBriefId:    sourceBriefId ?? null,
      sourceBriefTitle: sourceBriefTitle ?? '',
    });
  } catch (logErr) {
    console.error('[reprioritizeCategory] Failed to write duplicate SystemLog:', logErr.message);
  }
}

async function persistPriorities(category, leads, priorityByTitle) {
  const leadOps  = [];
  const briefOps = [];
  for (const l of leads) {
    const p = priorityByTitle.get(l.title.toLowerCase().trim());
    if (p == null) continue;
    leadOps.push({
      updateOne: {
        filter: { _id: l._id },
        update: { $set: { priorityNumber: p } },
      },
    });
    briefOps.push({
      updateMany: {
        filter: { category, title: l.title },
        update: { $set: { priorityNumber: p } },
      },
    });
  }
  if (leadOps.length)  await IntelLead.bulkWrite(leadOps);
  if (briefOps.length) await IntelligenceBrief.bulkWrite(briefOps);
}

/**
 * Full-category rerank. Sends the entire list and asks the AI to order
 * every item 1..N. Used for small categories or when too many items need
 * placing (initial seed, heavy backfill).
 *
 * Returns `true` on success, `false` on total failure (after logging).
 */
async function tryFullRerank({
  category, leads, newStubs, sourceBriefId, sourceBriefTitle, openRouterChat,
}) {
  const N = leads.length;
  const suppliedTitles = leads.map(l => l.title);
  const newTitles = (newStubs && newStubs.length > 0)
    ? newStubs.map(s => s.title)
    : leads.filter(l => l.priorityNumber == null).map(l => l.title);

  const prompt = `You are ordering a list of RAF intel brief topics by recommended learning priority within the "${category}" category.

The list currently has ${N} entries. ${newTitles.length} topic(s) need to be placed in the correct learning order: ${newTitles.map(t => `"${t}"`).join(', ')}.

Current list (title — one-line description, ordered by existing priority where known):
${leads.map(l => `${l.priorityNumber != null ? l.priorityNumber : '?'}. "${l.title}"${l.subtitle ? ` — ${l.subtitle}` : ''}${l.isHistoric ? ' [HISTORIC]' : ''}`).join('\n')}

Assign a priority number from 1 to ${N} to every entry. Priority 1 = most foundational / essential for a new RAF learner. Entries marked [HISTORIC] are retired, concluded, or no longer current — they should generally rank lower than current/active topics, as a potential RAF applicant needs to understand today's RAF first. Preserve the existing relative ordering of already-numbered entries unless a new entry clearly belongs between them. Every number from 1 to ${N} must be used exactly once.

IMPORTANT — also check for duplicates: if any entries in the list refer to the same real-world subject under different names (e.g. "RAF College Cranwell" and "RAF Cranwell", or "Eurofighter" and "Eurofighter Typhoon"), list them in a "duplicates" array. Each entry should name both titles so they can be merged.

Return ONLY valid JSON — no markdown, no extra text:
{
  "rankings": [
    { "title": "exact title", "priority": 1 }
  ],
  "duplicates": [
    { "keep": "preferred title", "remove": "duplicate title", "reason": "short explanation" }
  ]
}`;

  let lastFailureReason = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let rankings = [];
    let duplicates = [];
    try {
      // 8192 tokens covers ~250+ items at ~30 tokens each; 2048 was truncating
      // responses for large categories (e.g. Terminology at N=126).
      const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 8192);
      const content = raw.choices?.[0]?.message?.content ?? '{}';
      const cleaned = content.replace(/```json\n?|```/g, '').trim();
      const parsed  = JSON.parse(cleaned);
      rankings   = parsed.rankings ?? [];
      duplicates = parsed.duplicates ?? [];
    } catch (err) {
      lastFailureReason = `Attempt ${attempt}: JSON parse error — ${err.message}`;
      console.warn(`[reprioritizeCategory:full] ${lastFailureReason}`);
      continue;
    }

    const validationError = validateRankings(rankings, suppliedTitles);
    if (validationError) {
      lastFailureReason = `Attempt ${attempt}: ${validationError}`;
      console.warn(`[reprioritizeCategory:full] ${lastFailureReason}`);
      continue;
    }

    const priorityByTitle = new Map(
      rankings.map(r => [r.title.toLowerCase().trim(), r.priority])
    );
    await persistPriorities(category, leads, priorityByTitle);
    await logDuplicates(category, duplicates, sourceBriefId, sourceBriefTitle);

    console.log(`[reprioritizeCategory:full] "${category}" re-ranked (${N} leads + matching briefs) on attempt ${attempt}`);
    return true;
  }

  console.error(`[reprioritizeCategory:full] Failed after ${MAX_ATTEMPTS} attempts for "${category}". Logging to SystemLog.`);
  try {
    await SystemLog.create({
      type:             'priority_ranking_failure',
      category,
      newStubs,
      sourceBriefId:    sourceBriefId ?? null,
      sourceBriefTitle: sourceBriefTitle ?? '',
      failureReason:    lastFailureReason,
      attempts:         MAX_ATTEMPTS,
    });
  } catch (logErr) {
    console.error('[reprioritizeCategory:full] Failed to write SystemLog:', logErr.message);
  }
  return false;
}

/**
 * Incremental placement. Sends the existing ranked list as context and asks
 * the AI to assign a target priority only to each new title. We then splice
 * them into the existing order and renumber 1..N.
 *
 * Scales to arbitrary category sizes because the AI's output grows with the
 * number of *new* items, not the total. Returns `true` on success, `false`
 * if all attempts fail (caller may then fall back to full rerank).
 */
async function tryIncrementalPlacement({
  category, leads, rankedLeads, toPlace, sourceBriefId, sourceBriefTitle, openRouterChat,
}) {
  const M = rankedLeads.length;
  const K = toPlace.length;
  const N = M + K;

  const leadByTitle = new Map(leads.map(l => [l.title.toLowerCase().trim(), l]));
  const toPlaceDetails = toPlace.map(t => leadByTitle.get(t.toLowerCase().trim())).filter(Boolean);

  const prompt = `You are inserting new RAF intel brief topics into an existing priority-ranked learning order within the "${category}" category.

The existing ranked list has ${M} entries already in learning priority order (1 = most foundational). You will insert ${K} new topic(s) into this list, producing a final combined list of ${N} entries.

Existing ranked list:
${rankedLeads.map(l => `${l.priorityNumber}. "${l.title}"${l.subtitle ? ` — ${l.subtitle}` : ''}${l.isHistoric ? ' [HISTORIC]' : ''}`).join('\n')}

New topic(s) to insert:
${toPlaceDetails.map(l => `- "${l.title}"${l.subtitle ? ` — ${l.subtitle}` : ''}${l.isHistoric ? ' [HISTORIC]' : ''}`).join('\n')}

For each new topic, return the priority number (1 to ${N}) where it should sit in the final combined list. Priority 1 = most foundational / essential for a new RAF learner. Entries marked [HISTORIC] are retired or no longer current — they should generally rank lower than current/active topics. Do NOT return priorities for the existing entries; they will be renumbered automatically after the new topics are inserted.

Also check for duplicates: if any entries (existing or new) refer to the same real-world subject under different names (e.g. "RAF College Cranwell" and "RAF Cranwell"), list them in a "duplicates" array.

Return ONLY valid JSON — no markdown, no extra text:
{
  "placements": [
    { "title": "exact title of new topic", "priority": 17 }
  ],
  "duplicates": [
    { "keep": "preferred title", "remove": "duplicate title", "reason": "short explanation" }
  ]
}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let placements = [];
    let duplicates = [];
    try {
      const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 2048);
      const content = raw.choices?.[0]?.message?.content ?? '{}';
      const cleaned = content.replace(/```json\n?|```/g, '').trim();
      const parsed  = JSON.parse(cleaned);
      placements = parsed.placements ?? [];
      duplicates = parsed.duplicates ?? [];
    } catch (err) {
      console.warn(`[reprioritizeCategory:incremental] Attempt ${attempt}: JSON parse error — ${err.message}`);
      continue;
    }

    const validationError = validatePlacements(placements, toPlace, N);
    if (validationError) {
      console.warn(`[reprioritizeCategory:incremental] Attempt ${attempt}: ${validationError}`);
      continue;
    }

    // Build final order: start with existing ranked leads in priority order,
    // then splice each new placement in at its target index. Process sorted
    // ascending so later (higher-priority-number) inserts don't shift the
    // positions we've already decided.
    const orderedRanked = [...rankedLeads].sort((a, b) => a.priorityNumber - b.priorityNumber);
    const working = orderedRanked.map(l => l.title);

    const sortedPlacements = [...placements].sort((a, b) => a.priority - b.priority);
    for (const p of sortedPlacements) {
      const idx = Math.max(0, Math.min(working.length, p.priority - 1));
      working.splice(idx, 0, p.title);
    }

    const priorityByTitle = new Map(working.map((title, i) => [title.toLowerCase().trim(), i + 1]));
    await persistPriorities(category, leads, priorityByTitle);
    await logDuplicates(category, duplicates, sourceBriefId, sourceBriefTitle);

    console.log(`[reprioritizeCategory:incremental] "${category}" — placed ${K} new into ${M} existing (final N=${N}) on attempt ${attempt}`);
    return true;
  }

  console.warn(`[reprioritizeCategory:incremental] "${category}" — failed after ${MAX_ATTEMPTS} attempts`);
  return false;
}

/**
 * Re-rank all IntelLeads in a category after new stubs have been added.
 *
 * Dispatches to one of two strategies:
 *   - Incremental: when the category is already well-ranked and the number
 *     of items needing placement is small — sends only the existing order
 *     as context and asks the AI to place the new items. Scales to any
 *     category size.
 *   - Full rerank: for initial seeding, small categories, or when too many
 *     items need placing to trust incremental insertion.
 *
 * If incremental fails validation on every attempt, we fall back to full
 * rerank before giving up.
 *
 * @param {string}   category
 * @param {Array}    newStubs          - [{ title, briefId }] that triggered this.
 *                                       May be empty/null — when so, any leads
 *                                       with priorityNumber == null are treated
 *                                       as the "new" entries needing placement.
 * @param {*}        sourceBriefId     - the brief whose keywords seeded the stubs
 * @param {string}   sourceBriefTitle
 * @param {Function} openRouterChat
 */
async function reprioritizeCategory(category, newStubs, sourceBriefId, sourceBriefTitle, openRouterChat) {
  const leads = await IntelLead.find(
    { category },
    'title subtitle priorityNumber isHistoric'
  ).lean();

  if (leads.length === 0) return;

  // Sort: numbered leads first (by current priority), then nulls at end
  leads.sort((a, b) => {
    if (a.priorityNumber == null && b.priorityNumber == null) return 0;
    if (a.priorityNumber == null) return 1;
    if (b.priorityNumber == null) return -1;
    return a.priorityNumber - b.priorityNumber;
  });

  const newStubTitleSet = new Set((newStubs || []).map(s => s.title.toLowerCase().trim()));
  const rankedLeads     = leads.filter(l => l.priorityNumber != null);
  const toPlace         = leads
    .filter(l => l.priorityNumber == null || newStubTitleSet.has(l.title.toLowerCase().trim()))
    .map(l => l.title);

  if (toPlace.length === 0) {
    console.log(`[reprioritizeCategory] "${category}" already fully ranked — skipping`);
    return;
  }

  const canIncremental = rankedLeads.length >= INCREMENTAL_MIN_RANKED
                      && toPlace.length   <= INCREMENTAL_MAX_TO_PLACE;

  if (canIncremental) {
    const ok = await tryIncrementalPlacement({
      category, leads, rankedLeads, toPlace,
      sourceBriefId, sourceBriefTitle, openRouterChat,
    });
    if (ok) return;
    console.warn(`[reprioritizeCategory] "${category}" — incremental failed, falling back to full rerank`);
  }

  await tryFullRerank({
    category, leads, newStubs,
    sourceBriefId, sourceBriefTitle, openRouterChat,
  });
}

module.exports = { reprioritizeCategory };
