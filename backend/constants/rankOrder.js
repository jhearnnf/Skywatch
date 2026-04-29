// Canonical RAF rank order — single source of truth for rankOrder values stored
// on IntelLead.rankOrder and mirrored to IntelligenceBrief.gameData.rankHierarchyOrder.
//
// The list reflects the *current* RAF structure with modern titles
// (Air Specialist Class 1/2 introduced 2022, replacing SAC/LAC).
// Aliases are recognised so historic titles still resolve during backfill or
// if a brief title hasn't been migrated yet.
//
// Position in this array == rankOrder. 1 = most senior.

const CANONICAL_RANKS = [
  { order: 1,  title: 'Marshal of the Royal Air Force', aliases: [] },
  { order: 2,  title: 'Air Chief Marshal',              aliases: [] },
  { order: 3,  title: 'Air Marshal',                    aliases: [] },
  { order: 4,  title: 'Air Vice-Marshal',               aliases: ['Air Vice Marshal'] },
  { order: 5,  title: 'Air Commodore',                  aliases: [] },
  { order: 6,  title: 'Group Captain',                  aliases: [] },
  { order: 7,  title: 'Wing Commander',                 aliases: [] },
  { order: 8,  title: 'Squadron Leader',                aliases: [] },
  { order: 9,  title: 'Flight Lieutenant',              aliases: [] },
  { order: 10, title: 'Flying Officer',                 aliases: [] },
  { order: 11, title: 'Pilot Officer',                  aliases: [] },
  { order: 12, title: 'Warrant Officer',                aliases: [] },
  { order: 13, title: 'Master Aircrew',                 aliases: [] },
  { order: 14, title: 'Flight Sergeant',                aliases: [] },
  { order: 15, title: 'Chief Technician',               aliases: [] },
  { order: 16, title: 'Sergeant',                       aliases: [] },
  { order: 17, title: 'Corporal',                       aliases: [] },
  { order: 18, title: 'Junior Technician',              aliases: [] },
  { order: 19, title: 'Air Specialist (Class 1)',       aliases: ['Senior Aircraftman', 'Senior Aircraftwoman', 'Senior Aircraftman / Senior Aircraftwoman', 'SAC'] },
  { order: 20, title: 'Air Specialist (Class 2)',       aliases: ['Leading Aircraftman', 'Leading Aircraftwoman', 'Leading Aircraftman / Leading Aircraftwoman', 'LAC'] },
  { order: 21, title: 'Air Recruit',                    aliases: ['Aircraftman', 'Aircraftwoman', 'Aircraftman / Aircraftwoman'] },
];

// Build a lookup map of every recognised name → order, with longer names first
// so e.g. "Air Vice-Marshal" beats "Air Marshal" on substring match.
const NAME_TO_ORDER = (() => {
  const entries = [];
  for (const r of CANONICAL_RANKS) {
    entries.push([r.title, r.order]);
    for (const a of r.aliases) entries.push([a, r.order]);
  }
  // Longest-first so substring lookups are unambiguous
  entries.sort((a, b) => b[0].length - a[0].length);
  return entries;
})();

// Resolve a brief/lead title to its canonical rankOrder. Case-insensitive,
// substring match (so "Sergeant (RAF)" still hits "Sergeant"). Returns null
// when nothing matches.
function lookupRankOrderByTitle(title) {
  const t = (title || '').toLowerCase();
  if (!t) return null;
  for (const [name, order] of NAME_TO_ORDER) {
    if (t.includes(name.toLowerCase())) return order;
  }
  return null;
}

module.exports = { CANONICAL_RANKS, lookupRankOrderByTitle };
