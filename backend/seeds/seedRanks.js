const Rank = require('../models/Rank');

const RAF_RANKS = [
  { rankNumber: 1,  rankName: 'Aircraftman',          rankAbbreviation: 'AC',       rankType: 'enlisted_aviator' },
  { rankNumber: 2,  rankName: 'Leading Aircraftman',  rankAbbreviation: 'LAC',      rankType: 'enlisted_aviator' },
  { rankNumber: 3,  rankName: 'Senior Aircraftman',   rankAbbreviation: 'SAC',      rankType: 'enlisted_aviator' },
  { rankNumber: 4,  rankName: 'Corporal',              rankAbbreviation: 'Cpl',      rankType: 'non_commissioned_aircrew' },
  { rankNumber: 5,  rankName: 'Sergeant',              rankAbbreviation: 'Sgt',      rankType: 'non_commissioned_aircrew' },
  { rankNumber: 6,  rankName: 'Chief Technician',      rankAbbreviation: 'Ch Tech',  rankType: 'non_commissioned_aircrew' },
  { rankNumber: 7,  rankName: 'Flight Sergeant',       rankAbbreviation: 'FS',       rankType: 'non_commissioned_aircrew' },
  { rankNumber: 8,  rankName: 'Warrant Officer',       rankAbbreviation: 'WO',       rankType: 'non_commissioned_aircrew' },
  { rankNumber: 9,  rankName: 'Pilot Officer',         rankAbbreviation: 'Plt Off',  rankType: 'commissioned_officer' },
  { rankNumber: 10, rankName: 'Flying Officer',        rankAbbreviation: 'Fg Off',   rankType: 'commissioned_officer' },
  { rankNumber: 11, rankName: 'Flight Lieutenant',     rankAbbreviation: 'Flt Lt',   rankType: 'commissioned_officer' },
  { rankNumber: 12, rankName: 'Squadron Leader',       rankAbbreviation: 'Sqn Ldr',  rankType: 'commissioned_officer' },
  { rankNumber: 13, rankName: 'Wing Commander',        rankAbbreviation: 'Wg Cdr',   rankType: 'commissioned_officer' },
  { rankNumber: 14, rankName: 'Group Captain',         rankAbbreviation: 'Gp Capt',  rankType: 'commissioned_officer' },
  { rankNumber: 15, rankName: 'Air Commodore',         rankAbbreviation: 'Air Cdre', rankType: 'commissioned_officer' },
  { rankNumber: 16, rankName: 'Air Vice-Marshal',      rankAbbreviation: 'AVM',      rankType: 'commissioned_officer' },
  { rankNumber: 17, rankName: 'Air Marshal',           rankAbbreviation: 'AM',       rankType: 'commissioned_officer' },
  { rankNumber: 18, rankName: 'Air Chief Marshal',     rankAbbreviation: 'ACM',      rankType: 'commissioned_officer' },
  { rankNumber: 19, rankName: 'Marshal of the RAF',   rankAbbreviation: 'MRAF',     rankType: 'commissioned_officer' },
];

async function seedRanks() {
  const count = await Rank.countDocuments();
  if (count >= 19) return;
  await Rank.deleteMany({});
  await Rank.insertMany(RAF_RANKS);
  console.log('Seeded 19 RAF ranks');
}

module.exports = seedRanks;
