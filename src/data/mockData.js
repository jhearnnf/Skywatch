// Mock leaderboard — top agents by total airstars
export const MOCK_LEADERBOARD = [
  { agentNumber: '8832941', totalAirstars: 14820 },
  { agentNumber: '1123456', totalAirstars: 8950  },
  { agentNumber: '7654321', totalAirstars: 5320  },
  { agentNumber: '2987654', totalAirstars: 3100  },
  { agentNumber: '5544332', totalAirstars: 2430  },
  { agentNumber: '9182736', totalAirstars: 1890  },
  { agentNumber: '3312890', totalAirstars: 1250  },
  { agentNumber: '6789012', totalAirstars:  780  },
  { agentNumber: '4471823', totalAirstars:  310  },
  { agentNumber: '2234567', totalAirstars:  175  },
]

export const MOCK_RANKS = [
  { rankNumber: 1,  rankName: 'Aircraftman',          abbreviation: 'AC',      rankType: 'enlisted_aviator' },
  { rankNumber: 2,  rankName: 'Leading Aircraftman',  abbreviation: 'LAC',     rankType: 'enlisted_aviator' },
  { rankNumber: 3,  rankName: 'Senior Aircraftman',   abbreviation: 'SAC',     rankType: 'enlisted_aviator' },
  { rankNumber: 4,  rankName: 'Corporal',              abbreviation: 'Cpl',     rankType: 'non_commissioned_aircrew' },
  { rankNumber: 5,  rankName: 'Sergeant',              abbreviation: 'Sgt',     rankType: 'non_commissioned_aircrew' },
  { rankNumber: 6,  rankName: 'Chief Technician',      abbreviation: 'Ch Tech', rankType: 'non_commissioned_aircrew' },
  { rankNumber: 7,  rankName: 'Flight Sergeant',       abbreviation: 'FS',      rankType: 'non_commissioned_aircrew' },
  { rankNumber: 8,  rankName: 'Warrant Officer',       abbreviation: 'WO',      rankType: 'non_commissioned_aircrew' },
  { rankNumber: 9,  rankName: 'Pilot Officer',         abbreviation: 'Plt Off', rankType: 'commissioned_officer' },
  { rankNumber: 10, rankName: 'Flying Officer',        abbreviation: 'Fg Off',  rankType: 'commissioned_officer' },
  { rankNumber: 11, rankName: 'Flight Lieutenant',     abbreviation: 'Flt Lt',  rankType: 'commissioned_officer' },
  { rankNumber: 12, rankName: 'Squadron Leader',       abbreviation: 'Sqn Ldr', rankType: 'commissioned_officer' },
  { rankNumber: 13, rankName: 'Wing Commander',        abbreviation: 'Wg Cdr',  rankType: 'commissioned_officer' },
  { rankNumber: 14, rankName: 'Group Captain',         abbreviation: 'Gp Capt', rankType: 'commissioned_officer' },
  { rankNumber: 15, rankName: 'Air Commodore',         abbreviation: 'Air Cdre',rankType: 'commissioned_officer' },
  { rankNumber: 16, rankName: 'Air Vice-Marshal',      abbreviation: 'AVM',     rankType: 'commissioned_officer' },
  { rankNumber: 17, rankName: 'Air Marshal',           abbreviation: 'AM',      rankType: 'commissioned_officer' },
  { rankNumber: 18, rankName: 'Air Chief Marshal',     abbreviation: 'ACM',     rankType: 'commissioned_officer' },
  { rankNumber: 19, rankName: 'Marshal of the RAF',   abbreviation: 'MRAF',    rankType: 'commissioned_officer' },
]

export const CATEGORY_DESCRIPTIONS = {
  News:        'The latest RAF news and operations.',
  Aircrafts:   'Fast jets, transport, rotary wing, and more.',
  Bases:       'UK and overseas RAF stations.',
  Ranks:       'Commissioned officers and NCOs.',
  Squadrons:   'Active, reserve, and historic squadrons.',
  Training:    'From IOT to advanced flying training.',
  Roles:       'Every trade and branch explained.',
  Threats:     'Air threats, SAMs, and electronic warfare.',
  Allies:      'NATO, Five Eyes, and bilateral partners.',
  Missions:    'Historic and modern air operations.',
  AOR:         'Area of responsibility and global deployments.',
  Tech:        'Weapons, sensors, and future programmes.',
  Terminology: 'Key RAF terminology and concepts.',
  Treaties:    'Alliances, agreements, and arms control.',
  Heritage:    'Traditions, memorials, and RAF history.',
  Actors:      'Heads of state, commanders, and key figures of defence interest.',
}

import { CATEGORIES } from '../../backend/constants/categories.json'
export { CATEGORIES }

export const CATEGORY_ICONS = {
  News:        '📰',
  Aircrafts:   '✈️',
  Bases:       '🏔️',
  Ranks:       '🎖️',
  Squadrons:   '⚡',
  Training:    '🎯',
  Roles:       '🛡️',
  Threats:     '⚠️',
  Allies:      '🤝',
  Missions:    '🚀',
  AOR:         '🌍',
  Tech:        '💡',
  Terminology: '📖',
  Treaties:    '📜',
  Heritage:    '🏅',
  Actors:      '👤',
}

export const MOCK_BRIEFS = [
  {
    _id: 'brief-001',
    category: 'News',
    title: 'RAF Typhoons Intercept Russian Aircraft Over North Sea',
    subtitle: 'Quick Reaction Alert scramble marks third such incident this quarter.',
    descriptionSections: [
      'Royal Air Force Typhoon jets were scrambled from RAF Lossiemouth on Tuesday following the detection of Russian Tupolev Tu-95 Bear aircraft approaching UK airspace from the north. The QRA intercept was coordinated with NATO allies and the aircraft were shadowed until they turned back. The Ministry of Defence confirmed no incursion into sovereign airspace occurred. The Typhoon remains the backbone of UK air defence, capable of reaching intercept speed within minutes of the alert being triggered. Russia\'s strategic bomber patrols are a routine intelligence-gathering exercise that tests NATO response times and procedures.',
    ],
    keywords: [
      { _id: 'kw-1', keyword: 'Typhoon',      generatedDescription: 'RAF Eurofighter Typhoon multirole combat aircraft.' },
      { _id: 'kw-2', keyword: 'QRA',           generatedDescription: 'Quick Reaction Alert — 24/7 airborne intercept readiness.' },
      { _id: 'kw-3', keyword: 'RAF Lossiemouth', generatedDescription: 'Primary QRA (North) station in Moray, Scotland.' },
      { _id: 'kw-4', keyword: 'NATO',          generatedDescription: 'North Atlantic Treaty Organisation collective defence alliance.' },
    ],
    sources: [
      { url: 'https://www.bbc.co.uk/news', siteName: 'BBC News', articleDate: '2026-02-20' },
      { url: 'https://www.mod.uk',         siteName: 'MOD',      articleDate: '2026-02-20' },
    ],
    media:    [],
    dateAdded: '2026-02-20T08:00:00Z',
  },
  {
    _id: 'brief-002',
    category: 'Aircrafts',
    title: 'Eurofighter Typhoon',
    subtitle: 'Multi-role swing-role combat aircraft in service with the RAF.',
    descriptionSections: [
      'The Eurofighter Typhoon is a twin-engine, canard-delta wing, multirole combat aircraft. It is highly agile, primarily designed for air superiority, but is fully capable of ground attack and maritime roles. The Typhoon entered RAF service in 2003 and is operated by both XI Squadron and 1 Squadron from RAF Coningsby, as well as 6 Squadron and 11 Squadron at RAF Lossiemouth.',
      'Its radar system, CAPTOR-E AESA, provides a wide field of regard and advanced electronic warfare capabilities. The aircraft can carry a mix of Meteor, ASRAAM, Brimstone, and Paveway IV munitions.',
    ],
    keywords: [
      { _id: 'kw-5',  keyword: 'AESA',        generatedDescription: 'Active Electronically Scanned Array — advanced radar technology.' },
      { _id: 'kw-6',  keyword: 'Meteor',       generatedDescription: 'Beyond-visual-range air-to-air missile used by RAF Typhoons.' },
      { _id: 'kw-7',  keyword: 'Brimstone',    generatedDescription: 'Dual-mode seeker air-to-surface missile for precision strike.' },
      { _id: 'kw-8',  keyword: 'XI Squadron',  generatedDescription: 'RAF Typhoon fast jet squadron based at RAF Coningsby.' },
    ],
    sources: [
      { url: 'https://www.raf.mod.uk/aircraft/typhoon', siteName: 'RAF', articleDate: '2025-01-01' },
    ],
    media:    [],
    dateAdded: '2026-01-15T09:00:00Z',
  },
  {
    _id: 'brief-003',
    category: 'Ranks',
    title: 'RAF Rank Structure — Commissioned Officers',
    subtitle: 'From Pilot Officer to Marshal of the Royal Air Force.',
    descriptionSections: [
      'The RAF commissioned officer ranks are divided into three broad bands: junior officers, senior officers, and air officers. Junior officers span Pilot Officer (Plt Off), Flying Officer (Fg Off), and Flight Lieutenant (Flt Lt).',
      'Senior officers include Squadron Leader (Sqn Ldr), Wing Commander (Wg Cdr), and Group Captain (Gp Capt). Air officers rank from Air Commodore (Air Cdre) through Air Vice-Marshal (AVM), Air Marshal (AM), Air Chief Marshal (ACM), to the ceremonial five-star rank of Marshal of the Royal Air Force (MRAF), which is awarded only in wartime or on exceptional occasions.',
    ],
    keywords: [
      { _id: 'kw-9',  keyword: 'Pilot Officer',         generatedDescription: 'Most junior commissioned rank in the RAF (OF-1).' },
      { _id: 'kw-10', keyword: 'Air Chief Marshal',     generatedDescription: 'Four-star air officer rank (OF-9), typically CAS or NATO commander.' },
      { _id: 'kw-11', keyword: 'Squadron Leader',       generatedDescription: 'Middle-tier commissioned officer rank (OF-4) in the RAF.' },
      { _id: 'kw-12', keyword: 'Flight Lieutenant',     generatedDescription: 'Junior commissioned officer rank (OF-3), typical for pilots.' },
    ],
    sources: [
      { url: 'https://www.raf.mod.uk/our-organisation/structure', siteName: 'RAF', articleDate: '2025-06-01' },
    ],
    media:    [],
    dateAdded: '2026-01-10T10:00:00Z',
  },
  {
    _id: 'brief-004',
    category: 'News',
    title: 'F-35B Lightning II Declared Fully Operational',
    subtitle: 'RAF and Royal Navy joint force achieves initial operational capability milestone.',
    descriptionSections: [
      'The UK\'s F-35B Lightning II fleet has been declared fully operational, marking a significant capability step for the nation\'s carrier strike group. Operating from HMS Queen Elizabeth and HMS Prince of Wales, the aircraft provides a fifth-generation stealth platform for both offensive and defensive operations. 617 Squadron — the Dambusters — led the initial operational declaration. The F-35B\'s short take-off and vertical landing capability makes it uniquely suited to carrier operations. Its sensor fusion and low observable characteristics represent a generational leap beyond legacy fast jets in the RAF\'s inventory.',
    ],
    keywords: [
      { _id: 'kw-13', keyword: 'F-35B',            generatedDescription: 'Fifth-generation STOVL stealth multirole combat aircraft.' },
      { _id: 'kw-14', keyword: '617 Squadron',      generatedDescription: 'RAF Marham-based fast jet squadron, the Dambusters.' },
      { _id: 'kw-15', keyword: 'HMS Queen Elizabeth', generatedDescription: 'UK\'s lead aircraft carrier of the Queen Elizabeth class.' },
      { _id: 'kw-16', keyword: 'STOVL',             generatedDescription: 'Short Take-Off and Vertical Landing capability.' },
    ],
    sources: [
      { url: 'https://www.gov.uk/government/news', siteName: 'GOV.UK', articleDate: '2026-02-18' },
    ],
    media:    [],
    dateAdded: '2026-02-18T14:00:00Z',
  },
  {
    _id: 'brief-005',
    category: 'Bases',
    title: 'RAF Brize Norton',
    subtitle: 'The RAF\'s largest station and primary air transport and air-to-air refuelling hub.',
    descriptionSections: [
      'RAF Brize Norton in Oxfordshire is the largest station in the Royal Air Force, covering over 3,000 acres. It is home to Air Mobility Force and hosts the A400M Atlas, Voyager KC2/KC3, and C-17 Globemaster III fleets.',
      'The station handles thousands of air transport movements per year, including operational support to global deployments, humanitarian missions, and repatriation flights. The Voyager aircraft operate in both passenger transport and air-to-air refuelling roles, extending the range of fast jet assets during operations. Brize Norton also houses No. 10 Squadron, operating the Sentinel R1 for airborne intelligence gathering.',
    ],
    keywords: [
      { _id: 'kw-17', keyword: 'A400M Atlas',     generatedDescription: 'RAF turboprop military transport aircraft by Airbus.' },
      { _id: 'kw-18', keyword: 'Voyager',          generatedDescription: 'RAF Airbus A330 MRTT for air transport and AAR.' },
      { _id: 'kw-19', keyword: 'C-17 Globemaster', generatedDescription: 'USAF/RAF strategic heavy-lift transport aircraft by Boeing.' },
      { _id: 'kw-20', keyword: 'No. 10 Squadron',  generatedDescription: 'RAF Brize Norton-based transport and ISR squadron.' },
    ],
    sources: [
      { url: 'https://www.raf.mod.uk/our-organisation/stations/raf-brize-norton', siteName: 'RAF', articleDate: '2025-09-01' },
    ],
    media:    [],
    dateAdded: '2026-01-05T11:00:00Z',
  },
  {
    _id: 'brief-006',
    category: 'Training',
    title: 'Initial Officer Training at RAF Cranwell',
    subtitle: 'The 30-week IOT programme that forges RAF officers.',
    descriptionSections: [
      'RAF College Cranwell in Lincolnshire is the home of officer training for the Royal Air Force. All RAF officers, regardless of branch or trade, complete Initial Officer Training (IOT) at Cranwell. The 30-week programme covers military skills, leadership, academic study, and physical fitness.',
      'Cadets progress through three phases: Foundation, Development, and Final. The programme culminates in the Sovereign\'s Parade, where newly commissioned officers receive their rank insignia.',
      'Cranwell has trained RAF officers since 1920, making it one of the oldest military aviation training colleges in the world. The college also hosts the Advanced Command and Staff Course (ACSC) for senior officers.',
    ],
    keywords: [
      { _id: 'kw-21', keyword: 'IOT',           generatedDescription: 'Initial Officer Training — 30-week RAF officer commissioning course.' },
      { _id: 'kw-22', keyword: 'RAF Cranwell',  generatedDescription: 'RAF College in Lincolnshire; home of officer training since 1920.' },
      { _id: 'kw-23', keyword: 'Sovereign\'s Parade', generatedDescription: 'Passing-out parade for newly commissioned RAF officers.' },
      { _id: 'kw-24', keyword: 'ACSC',          generatedDescription: 'Advanced Command and Staff Course for senior military officers.' },
    ],
    sources: [
      { url: 'https://www.raf.mod.uk/our-organisation/stations/raf-college-cranwell', siteName: 'RAF', articleDate: '2025-10-01' },
    ],
    media:    [],
    dateAdded: '2026-01-08T12:00:00Z',
  },
]
