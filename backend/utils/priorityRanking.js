const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const SystemLog         = require('../models/SystemLog');

const MAX_ATTEMPTS = 3;

/**
 * Validate an AI-returned rankings array against the supplied lead list.
 * Returns null on success, or a string describing the first failure found.
 *
 * Checks (all must pass):
 *  1. rankings is an array
 *  2. Correct length (N items)
 *  3. No unknown titles (every returned title matches a supplied one)
 *  4. No omitted titles (every supplied title appears in rankings)
 *  5. No duplicate titles
 *  6. Every priority is a positive integer
 *  7. Priority set is exactly {1, 2, ..., N} — no gaps, no duplicates
 */
function validateRankings(rankings, suppliedTitles) {
  const N = suppliedTitles.length;
  const suppliedSet = new Set(suppliedTitles.map(t => t.toLowerCase()));

  if (!Array.isArray(rankings))
    return 'Response "rankings" is not an array';

  if (rankings.length !== N)
    return `Expected ${N} items, got ${rankings.length}`;

  const seenTitles    = new Set();
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

  // Check for gaps — set must be exactly {1..N}
  for (let i = 1; i <= N; i++) {
    if (!seenPriorities.has(i))
      return `Priority sequence has a gap — ${i} is missing`;
  }

  return null; // all checks passed
}

/**
 * Re-rank all IntelLeads in a category after new stubs have been added.
 * Asks the AI to produce a full ordered list (1..N) for the category,
 * validates the response, and bulk-updates priorityNumber in DB.
 *
 * Up to MAX_ATTEMPTS retries. On total failure, writes a SystemLog record
 * with full context so the admin can review and fix manually.
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
  // Fetch all leads in this category, sorted by current priority (nulls last)
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

  const N = leads.length;
  const suppliedTitles = leads.map(l => l.title);

  // If the caller didn't pass specific new stubs, treat every unranked lead as "new".
  const newTitles = (newStubs && newStubs.length > 0)
    ? newStubs.map(s => s.title)
    : leads.filter(l => l.priorityNumber == null).map(l => l.title);

  // Nothing new, nothing null — category is already fully ranked. Skip the AI call.
  if (newTitles.length === 0) {
    console.log(`[reprioritizeCategory] "${category}" already fully ranked — skipping`);
    return;
  }

  const prompt = `You are ordering a list of RAF intel brief topics by recommended learning priority within the "${category}" category.

The list currently has ${N} entries. ${newTitles.length} topic(s) need to be placed in the correct learning order: ${newTitles.map(t => `"${t}"`).join(', ')}.

Current list (title — one-line description, ordered by existing priority where known):
${leads.map((l, i) => `${l.priorityNumber != null ? l.priorityNumber : '?'}. "${l.title}"${l.subtitle ? ` — ${l.subtitle}` : ''}${l.isHistoric ? ' [HISTORIC]' : ''}`).join('\n')}

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
      const raw     = await openRouterChat([{ role: 'user', content: prompt }], 'openai/gpt-4o-mini', 2048);
      const content = raw.choices?.[0]?.message?.content ?? '{}';
      const cleaned = content.replace(/```json\n?|```/g, '').trim();
      const parsed  = JSON.parse(cleaned);
      rankings   = parsed.rankings ?? [];
      duplicates = parsed.duplicates ?? [];
    } catch (err) {
      lastFailureReason = `Attempt ${attempt}: JSON parse error — ${err.message}`;
      console.warn(`[reprioritizeCategory] ${lastFailureReason}`);
      continue;
    }

    const validationError = validateRankings(rankings, suppliedTitles);
    if (validationError) {
      lastFailureReason = `Attempt ${attempt}: ${validationError}`;
      console.warn(`[reprioritizeCategory] ${lastFailureReason}`);
      continue;
    }

    // All checks passed — build a title→priority map (case-insensitive lookup)
    const priorityMap = new Map(
      rankings.map(r => [r.title.toLowerCase().trim(), r.priority])
    );

    // Bulk update all leads in this category
    const leadOps = leads.map(l => ({
      updateOne: {
        filter: { _id: l._id },
        update: { $set: { priorityNumber: priorityMap.get(l.title.toLowerCase().trim()) } },
      },
    }));
    await IntelLead.bulkWrite(leadOps);

    // Mirror the new priorities onto matching IntelligenceBrief documents
    // (match by category + title so both stub and published briefs are kept in sync).
    const briefOps = leads.map(l => ({
      updateMany: {
        filter: { category, title: l.title },
        update: { $set: { priorityNumber: priorityMap.get(l.title.toLowerCase().trim()) } },
      },
    }));
    await IntelligenceBrief.bulkWrite(briefOps);

    // Log any duplicates the AI detected for admin review
    if (duplicates.length) {
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

    console.log(`[reprioritizeCategory] "${category}" re-ranked (${N} leads + matching briefs) on attempt ${attempt}`);
    return; // success
  }

  // All attempts exhausted — log the failure
  console.error(`[reprioritizeCategory] Failed after ${MAX_ATTEMPTS} attempts for "${category}". Logging to SystemLog.`);
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
    console.error('[reprioritizeCategory] Failed to write SystemLog:', logErr.message);
  }
}

module.exports = { reprioritizeCategory };
