const IntelLead = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const GameQuizQuestion = require('../models/GameQuizQuestion');
const GameSessionQuizResult = require('../models/GameSessionQuizResult');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const GameOrderOfBattle = require('../models/GameOrderOfBattle');
const GameSessionOrderOfBattleResult = require('../models/GameSessionOrderOfBattleResult');
const GameFlashcardRecall = require('../models/GameFlashcardRecall');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const GameWhosAtAircraft = require('../models/GameWhosAtAircraft');
const GameSessionWhosAtAircraftResult = require('../models/GameSessionWhosAtAircraftResult');
const AircoinLog = require('../models/AircoinLog');

// ─────────────────────────────────────────────────────────────────────────────
// LEADS — canonical RAF knowledge graph entries
// Each entry becomes both an IntelLead and a stub IntelligenceBrief in the DB.
// Fields:
//   title      — canonical short name (unique key)
//   nickname   — informal name / callsign (optional)
//   subtitle   — one-line descriptor (optional)
//   category   — must match IntelligenceBrief CATEGORIES enum
//   subcategory — must match SUBCATEGORIES[category] (optional)
//   section    — grouping label for Admin UI
//   subsection — sub-grouping label for Admin UI
// ─────────────────────────────────────────────────────────────────────────────
const LEADS = [

  // ── RAF RANKS — Commissioned Officer ─────────────────────────────────────
  { title: 'Marshal of the Royal Air Force', nickname: 'MRAF', subtitle: 'Most senior RAF rank, held only in wartime or by senior Royals', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Air Chief Marshal', nickname: 'ACM', subtitle: 'Senior air officer, 4-star equivalent, heads RAF or major commands', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Air Marshal', nickname: 'AM', subtitle: 'Senior air officer, 3-star equivalent, commands major formations', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Air Vice-Marshal', nickname: 'AVM', subtitle: 'Senior air officer, 2-star equivalent, commands groups or major stations', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Air Commodore', nickname: 'Air Cdre', subtitle: 'Senior officer, 1-star equivalent, commands stations or specialist branches', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Group Captain', nickname: 'Gp Capt', subtitle: 'Senior officer equivalent to full colonel, often commands a station', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Wing Commander', nickname: 'Wg Cdr', subtitle: 'Mid-senior officer commanding a wing or large unit', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Squadron Leader', nickname: 'Sqn Ldr', subtitle: 'Officer commanding a squadron or equivalent-sized unit', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Flight Lieutenant', nickname: 'Flt Lt', subtitle: 'Junior officer rank, typically holding a flight commander or specialist role', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Flying Officer', nickname: 'Fg Off', subtitle: 'Junior officer rank, usually held during early commissioned service', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },
  { title: 'Pilot Officer', nickname: 'Plt Off', subtitle: 'Most junior commissioned officer rank, held on initial commission', category: 'Ranks', subcategory: 'Commissioned Officer', section: 'RAF RANKS', subsection: 'Commissioned Officer' },

  // ── RAF RANKS — Non-Commissioned ─────────────────────────────────────────
  { title: 'Warrant Officer', nickname: 'WO', subtitle: 'Most senior non-commissioned rank, the apex of the NCO career path', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Master Aircrew', nickname: 'MAcr', subtitle: 'Senior specialist aircrew rank for non-commissioned aircrew', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Flight Sergeant', nickname: 'Flt Sgt', subtitle: 'Senior NCO rank, often a section or team leader', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Chief Technician', nickname: 'Chf Tech', subtitle: 'Senior technical NCO rank unique to the RAF engineering branch', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Sergeant', nickname: 'Sgt', subtitle: 'Junior NCO rank, leading a small team or section', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Corporal', nickname: 'Cpl', subtitle: 'Most junior NCO rank in the RAF', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Junior Technician', nickname: 'JT', subtitle: 'Entry-level technical rank in the RAF engineering branch', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Senior Aircraftman / Senior Aircraftwoman', nickname: 'SAC', subtitle: 'Other-rank grade following basic training, above LAC', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Leading Aircraftman / Leading Aircraftwoman', nickname: 'LAC', subtitle: 'Junior other-rank, typically after initial trade training', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },
  { title: 'Aircraftman / Aircraftwoman', nickname: 'AC', subtitle: 'Most junior enlisted rank in the RAF', category: 'Ranks', subcategory: 'Non-Commissioned', section: 'RAF RANKS', subsection: 'Non-Commissioned' },

  // ── RAF RANKS — Specialist Roles & Designations (→ Roles) ────────────────
  { title: 'Qualified Flying Instructor', nickname: 'QFI', subtitle: 'Instructor qualified to teach flying to ab initio and advanced students', category: 'Roles', subcategory: 'Fast Jet Pilot', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Qualified Weapons Instructor', nickname: 'QWI', subtitle: 'Instructor qualified to teach weapons and tactical employment', category: 'Roles', subcategory: 'Fast Jet Pilot', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Master Aircrew Designation', nickname: 'MACr', subtitle: 'Specialist aircrew role recognition above standard NCO aircrew track', category: 'Roles', subcategory: 'Weapons Systems Operator', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Air Loadmaster', nickname: '', subtitle: 'Specialist responsible for cargo, passengers and airdrop on transport aircraft', category: 'Roles', subcategory: 'Weapons Systems Operator', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Air Engineer Officer', nickname: '', subtitle: 'Officer responsible for airborne engineering and aircraft systems management', category: 'Roles', subcategory: 'Engineer Officer', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Flight Operations Officer', nickname: '', subtitle: 'Officer managing flight operations planning and scheduling', category: 'Roles', subcategory: 'Multi-Engine Pilot', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Intelligence Officer', nickname: '', subtitle: 'Officer responsible for intelligence collection, analysis and briefing', category: 'Roles', subcategory: 'Intelligence Officer', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'JTAC', nickname: 'Joint Terminal Attack Controller', subtitle: 'Specialist who directs close air support from a ground position', category: 'Roles', subcategory: 'RAF Regiment', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Forward Air Controller', nickname: 'FAC', subtitle: 'Ground-based specialist directing aircraft onto close air support targets', category: 'Roles', subcategory: 'RAF Regiment', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Survival Evasion Resistance Extraction Instructor', nickname: 'SERE Instructor', subtitle: 'Instructor in survival, evasion, resistance and extraction techniques', category: 'Roles', subcategory: 'RAF Regiment', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Physical Training Instructor', nickname: 'PTI', subtitle: 'RAF specialist responsible for physical fitness training and assessment', category: 'Roles', subcategory: 'Logistics & Supply', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Air Traffic Control Officer', nickname: 'ATCO', subtitle: 'Officer responsible for safe sequencing and separation of air traffic', category: 'Roles', subcategory: 'Air Traffic Control Officer', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },
  { title: 'Airfield Damage Repair Engineer', nickname: '', subtitle: 'Specialist engineer trained to rapidly repair bomb-damaged runways', category: 'Roles', subcategory: 'Engineer Officer', section: 'RAF RANKS', subsection: 'Specialist Roles & Designations' },

  // ── RAF SQUADRONS — Active Front-Line ────────────────────────────────────
  { title: 'No. 1 Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 2 Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 3 Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Coningsby', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. IV Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 5 Squadron RAF', nickname: '', subtitle: 'Reserve air defence heritage squadron', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. VI Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 9 Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Marham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 11 Squadron RAF', nickname: '', subtitle: 'Typhoon FGR4, based at RAF Coningsby', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 12 Squadron RAF', nickname: '', subtitle: 'F-35B Lightning II, based at RAF Marham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 14 Squadron RAF', nickname: '', subtitle: 'F-35B Lightning II, based at RAF Marham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 16 Squadron RAF', nickname: '', subtitle: 'Typhoon and Protector RG1 mixed roles', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 17 Squadron RAF', nickname: '', subtitle: 'F-35B Lightning II, based at RAF Marham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 18 Squadron RAF', nickname: '', subtitle: 'Chinook heavy-lift helicopter, based at RAF Odiham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 22 Squadron RAF', nickname: '', subtitle: 'Search and rescue helicopter operations', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 24 Squadron RAF', nickname: '', subtitle: 'A400M Atlas strategic transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 27 Squadron RAF', nickname: '', subtitle: 'Chinook heavy-lift helicopter, based at RAF Odiham', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 29 Squadron RAF', nickname: '', subtitle: 'Typhoon OCU, based at RAF Coningsby', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 30 Squadron RAF', nickname: '', subtitle: 'A400M Atlas strategic transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 31 Squadron RAF', nickname: '', subtitle: 'Protector RG1 RPAS, based at RAF Waddington', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 32 Squadron RAF', nickname: 'The Royal Squadron', subtitle: 'VIP transport squadron based at RAF Northolt', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 33 Squadron RAF', nickname: '', subtitle: 'Puma medium utility helicopter, based at RAF Benson', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 39 Squadron RAF', nickname: '', subtitle: 'Protector RG1 and Reaper RPAS, based at RAF Waddington', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 41 Squadron RAF', nickname: '', subtitle: 'Reserve squadron with test and evaluation roles', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 47 Squadron RAF', nickname: '', subtitle: 'A400M Atlas strategic transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 51 Squadron RAF', nickname: '', subtitle: 'RC-135W Rivet Joint SIGINT aircraft, based at RAF Waddington', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 54 Squadron RAF', nickname: '', subtitle: 'Reserve squadron', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 56 Squadron RAF', nickname: '', subtitle: 'Reserve squadron', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 57 Squadron RAF', nickname: '', subtitle: 'Reserve squadron', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 70 Squadron RAF', nickname: '', subtitle: 'A400M Atlas strategic transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 72 Squadron RAF', nickname: '', subtitle: 'Reserve squadron', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 78 Squadron RAF', nickname: '', subtitle: 'Falklands and South Atlantic operations', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 84 Squadron RAF', nickname: '', subtitle: 'Griffon HT1 helicopter, based at RAF Akrotiri, Cyprus', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 99 Squadron RAF', nickname: '', subtitle: 'C-17 Globemaster III heavy strategic airlift, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 100 Squadron RAF', nickname: '', subtitle: 'Hawk T1 adversary and training squadron, based at RAF Leeming', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 101 Squadron RAF', nickname: '', subtitle: 'A330 Voyager tanker and transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 120 Squadron RAF', nickname: '', subtitle: 'P-8A Poseidon maritime patrol aircraft, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 201 Squadron RAF', nickname: '', subtitle: 'P-8A Poseidon maritime patrol aircraft, based at RAF Lossiemouth', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 206 Squadron RAF', nickname: '', subtitle: 'P-8A Poseidon OCU, reserve status', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 216 Squadron RAF', nickname: '', subtitle: 'A330 Voyager tanker and transport, based at RAF Brize Norton', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },
  { title: 'No. 230 Squadron RAF', nickname: '', subtitle: 'Puma medium utility helicopter, based at RAF Benson', category: 'Squadrons', subcategory: 'Active Front-Line', section: 'RAF SQUADRONS', subsection: 'Active Front-Line' },

  // ── RAF SQUADRONS — Training ──────────────────────────────────────────────
  { title: 'No. 4 Flying Training School', nickname: '', subtitle: 'RAF basic and advanced flying training school', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },
  { title: 'No. 6 Flying Training School', nickname: '', subtitle: 'RAF flying training school for multi-engine and rotary types', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },
  { title: 'Central Flying School', nickname: 'CFS', subtitle: 'The world\'s oldest flying training school, qualifying QFIs', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },
  { title: 'No. 22 Elementary Flying Training Squadron', nickname: '', subtitle: 'Elementary flying training for RAF student pilots', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },
  { title: 'No. 45 Squadron RAF', nickname: '', subtitle: 'Reserve multi-engine lead-in training squadron', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },
  { title: 'Air Cadet Flying Organisation', nickname: 'ACFO', subtitle: 'Organisation providing air experience and gliding for RAF Air Cadets', category: 'Squadrons', subcategory: 'Training', section: 'RAF SQUADRONS', subsection: 'Training Squadrons' },

  // ── RAF SQUADRONS — Royal Auxiliary Air Force ─────────────────────────────
  { title: 'No. 501 Squadron RAuxAF', nickname: '', subtitle: 'Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 502 Squadron RAuxAF', nickname: '', subtitle: 'Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 600 Squadron RAuxAF', nickname: 'City of London', subtitle: 'City of London Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 601 Squadron RAuxAF', nickname: 'County of London', subtitle: 'County of London Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 602 Squadron RAuxAF', nickname: 'City of Glasgow', subtitle: 'City of Glasgow Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 603 Squadron RAuxAF', nickname: 'City of Edinburgh', subtitle: 'City of Edinburgh Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 604 Squadron RAuxAF', nickname: 'County of Middlesex', subtitle: 'County of Middlesex Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 605 Squadron RAuxAF', nickname: 'County of Warwick', subtitle: 'County of Warwick Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 606 Squadron RAuxAF', nickname: 'Chilterns', subtitle: 'Chilterns Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 607 Squadron RAuxAF', nickname: 'County of Durham', subtitle: 'County of Durham Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 608 Squadron RAuxAF', nickname: 'North Riding', subtitle: 'North Riding Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 609 Squadron RAuxAF', nickname: 'West Riding', subtitle: 'West Riding Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 610 Squadron RAuxAF', nickname: 'County of Chester', subtitle: 'County of Chester Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 611 Squadron RAuxAF', nickname: 'West Lancashire', subtitle: 'West Lancashire Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 612 Squadron RAuxAF', nickname: 'County of Aberdeen', subtitle: 'County of Aberdeen Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 614 Squadron RAuxAF', nickname: 'County of Glamorgan', subtitle: 'County of Glamorgan Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },
  { title: 'No. 616 Squadron RAuxAF', nickname: 'South Yorkshire', subtitle: 'South Yorkshire Royal Auxiliary Air Force reserve squadron', category: 'Squadrons', subcategory: 'Royal Auxiliary Air Force', section: 'RAF SQUADRONS', subsection: 'Royal Auxiliary Air Force' },

  // ── RAF SQUADRONS — Historic ──────────────────────────────────────────────
  { title: 'No. 617 Squadron RAF', nickname: 'The Dambusters', subtitle: 'Famous for the 1943 Dambusters Raid using Barnes Wallis bouncing bombs', category: 'Squadrons', subcategory: 'Historic', section: 'RAF SQUADRONS', subsection: 'Historic Squadrons' },
  { title: 'No. 303 Squadron', nickname: 'The Ko\u015bciuszko Squadron', subtitle: 'Polish volunteer squadron, top scoring unit in the Battle of Britain', category: 'Squadrons', subcategory: 'Historic', section: 'RAF SQUADRONS', subsection: 'Historic Squadrons' },
  { title: 'No. 1 PRU', nickname: 'Photo Reconnaissance Unit', subtitle: 'WWII specialist photo reconnaissance unit capturing enemy intelligence', category: 'Squadrons', subcategory: 'Historic', section: 'RAF SQUADRONS', subsection: 'Historic Squadrons' },
  { title: 'Eagle Squadrons', nickname: '', subtitle: 'American volunteer squadrons flying with the RAF before US entered WWII', category: 'Squadrons', subcategory: 'Historic', section: 'RAF SQUADRONS', subsection: 'Historic Squadrons' },

  // ── RAF AIRCRAFT — Fast Jet ───────────────────────────────────────────────
  { title: 'Eurofighter Typhoon FGR4', nickname: 'Tiffie', subtitle: 'Twin-engine multirole fast jet, backbone of UK air defence and strike', category: 'Aircrafts', subcategory: 'Fast Jet', section: 'RAF AIRCRAFT', subsection: 'Fast Jet' },
  { title: 'Eurofighter Typhoon T3', nickname: '', subtitle: 'Two-seat trainer variant of the Typhoon for conversion and currency', category: 'Aircrafts', subcategory: 'Fast Jet', section: 'RAF AIRCRAFT', subsection: 'Fast Jet' },
  { title: 'F-35B Lightning II', nickname: 'Lightning', subtitle: 'STOVL stealth multirole fighter, based at RAF Marham', category: 'Aircrafts', subcategory: 'Fast Jet', section: 'RAF AIRCRAFT', subsection: 'Fast Jet' },
  { title: 'BAE Systems Hawk T1', nickname: '', subtitle: 'Advanced jet trainer and adversary aircraft, being retired', category: 'Aircrafts', subcategory: 'Fast Jet', section: 'RAF AIRCRAFT', subsection: 'Fast Jet' },
  { title: 'BAE Systems Hawk T2', nickname: '', subtitle: 'Advanced fast jet trainer used at RAF Valley', category: 'Aircrafts', subcategory: 'Fast Jet', section: 'RAF AIRCRAFT', subsection: 'Fast Jet' },

  // ── RAF AIRCRAFT — ISR & Surveillance ────────────────────────────────────
  { title: 'Boeing RC-135W Rivet Joint', nickname: 'Rivet Joint', subtitle: 'Signals intelligence aircraft operated by 51 Sqn from RAF Waddington', category: 'Aircrafts', subcategory: 'ISR & Surveillance', section: 'RAF AIRCRAFT', subsection: 'ISR & Surveillance' },
  { title: 'Beechcraft Shadow R1', nickname: 'Shadow', subtitle: 'Tactical ISR light aircraft, based at RAF Waddington', category: 'Aircrafts', subcategory: 'ISR & Surveillance', section: 'RAF AIRCRAFT', subsection: 'ISR & Surveillance' },
  { title: 'MQ-9A Reaper', nickname: 'Reaper', subtitle: 'RPAS based at RAF Waddington, being retired and replaced by Protector', category: 'Aircrafts', subcategory: 'ISR & Surveillance', section: 'RAF AIRCRAFT', subsection: 'ISR & Surveillance' },
  { title: 'Protector RG1', nickname: 'SkyGuardian', subtitle: 'MQ-9B RPAS replacing the Reaper, with enhanced range and payload', category: 'Aircrafts', subcategory: 'ISR & Surveillance', section: 'RAF AIRCRAFT', subsection: 'ISR & Surveillance' },
  { title: 'Boeing E-7A Wedgetail', nickname: 'Wedgetail', subtitle: 'Airborne early warning and control aircraft replacing the E-3D Sentry', category: 'Aircrafts', subcategory: 'ISR & Surveillance', section: 'RAF AIRCRAFT', subsection: 'ISR & Surveillance' },

  // ── RAF AIRCRAFT — Maritime Patrol ────────────────────────────────────────
  { title: 'Boeing P-8A Poseidon MRA1', nickname: 'Poseidon', subtitle: 'Maritime patrol and anti-submarine warfare aircraft based at RAF Lossiemouth', category: 'Aircrafts', subcategory: 'Maritime Patrol', section: 'RAF AIRCRAFT', subsection: 'Maritime Patrol' },

  // ── RAF AIRCRAFT — Transport & Tanker ────────────────────────────────────
  { title: 'Airbus A330 MRTT Voyager KC2/KC3', nickname: 'Voyager', subtitle: 'Multi-role AAR tanker and transport aircraft, based at RAF Brize Norton', category: 'Aircrafts', subcategory: 'Transport & Tanker', section: 'RAF AIRCRAFT', subsection: 'Transport & Tanker' },
  { title: 'Airbus A400M Atlas C1', nickname: 'Atlas', subtitle: 'Tactical and strategic transport aircraft based at RAF Brize Norton', category: 'Aircrafts', subcategory: 'Transport & Tanker', section: 'RAF AIRCRAFT', subsection: 'Transport & Tanker' },
  { title: 'Boeing C-17A Globemaster III', nickname: 'Globemaster', subtitle: 'Heavy strategic airlift aircraft based at RAF Brize Norton', category: 'Aircrafts', subcategory: 'Transport & Tanker', section: 'RAF AIRCRAFT', subsection: 'Transport & Tanker' },
  { title: 'BAe 146 CC2/C3', nickname: '', subtitle: 'VIP and Royal Squadron transport aircraft based at RAF Northolt', category: 'Aircrafts', subcategory: 'Transport & Tanker', section: 'RAF AIRCRAFT', subsection: 'Transport & Tanker' },

  // ── RAF AIRCRAFT — Rotary Wing ────────────────────────────────────────────
  { title: 'Boeing Chinook HC6/6A', nickname: 'Wokka Wokka', subtitle: 'Heavy-lift tandem rotor helicopter based at RAF Odiham', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },
  { title: 'Airbus Puma HC2', nickname: '', subtitle: 'Medium utility helicopter based at RAF Benson, being retired', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },
  { title: 'AgustaWestland AW109 Jupiter HT1', nickname: 'Jupiter', subtitle: 'Helicopter trainer used at RAF Shawbury', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },
  { title: 'Airbus H135 Juno HT1', nickname: 'Juno', subtitle: 'Helicopter trainer used at RAF Shawbury for rotary wing training', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },
  { title: 'Sikorsky Griffin HT1', nickname: '', subtitle: 'SAR trainer operated from RAF Valley', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },
  { title: 'AgustaWestland AW101 Merlin', nickname: 'Merlin', subtitle: 'Medium-lift helicopter operated jointly with the Royal Navy', category: 'Aircrafts', subcategory: 'Rotary Wing', section: 'RAF AIRCRAFT', subsection: 'Rotary Wing' },

  // ── RAF AIRCRAFT — Training Aircraft ─────────────────────────────────────
  { title: 'Grob G120TP Prefect T1', nickname: 'Prefect', subtitle: 'Basic fixed-wing turboprop trainer based at Cranwell and Wittering', category: 'Aircrafts', subcategory: 'Training Aircraft', section: 'RAF AIRCRAFT', subsection: 'Training Aircraft' },
  { title: 'Beechcraft Avenger T1', nickname: '', subtitle: 'ISR specialist trainer aircraft', category: 'Aircrafts', subcategory: 'Training Aircraft', section: 'RAF AIRCRAFT', subsection: 'Training Aircraft' },
  { title: 'Grob Tutor T1', nickname: 'Tutor', subtitle: 'Elementary flying training aircraft used by RAF and Air Cadets', category: 'Aircrafts', subcategory: 'Training Aircraft', section: 'RAF AIRCRAFT', subsection: 'Training Aircraft' },
  { title: 'Shorts Tucano T1', nickname: '', subtitle: 'Turboprop advanced trainer, retired 2019', category: 'Aircrafts', subcategory: 'Training Aircraft', section: 'RAF AIRCRAFT', subsection: 'Training Aircraft' },

  // ── RAF AIRCRAFT — Ground-Based Air Defence ───────────────────────────────
  { title: 'Sky Sabre / CAMM', nickname: 'Sky Sabre', subtitle: 'Current ground-based air defence system using Common Anti-Air Modular Missile', category: 'Aircrafts', subcategory: 'Ground-Based Air Defence', section: 'RAF AIRCRAFT', subsection: 'Ground-Based Air Defence' },
  { title: 'Starstreak HVM', nickname: 'Starstreak', subtitle: 'High Velocity Missile short-range GBAD system operated by RAF Regiment', category: 'Aircrafts', subcategory: 'Ground-Based Air Defence', section: 'RAF AIRCRAFT', subsection: 'Ground-Based Air Defence' },
  { title: 'Rapier FSC', nickname: 'Rapier', subtitle: 'Surface-to-air missile system retired from RAF service in 2021', category: 'Aircrafts', subcategory: 'Ground-Based Air Defence', section: 'RAF AIRCRAFT', subsection: 'Ground-Based Air Defence' },

  // ── RAF AIRCRAFT — Historic: Cold War ────────────────────────────────────
  { title: 'BAC Lightning F6', nickname: '', subtitle: 'Mach 2 interceptor operated from 1960s until 1988', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'English Electric Canberra PR9', nickname: '', subtitle: 'High-altitude jet bomber and reconnaissance aircraft, 1951–2006', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Hawker Siddeley Buccaneer S2B', nickname: 'Brick', subtitle: 'Low-level strike aircraft operated 1962–1994', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'SEPECAT Jaguar GR3A', nickname: '', subtitle: 'Ground attack aircraft operated 1974–2007', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Hawker Siddeley Nimrod MR2', nickname: '', subtitle: 'Maritime patrol and SIGINT aircraft, 1969–2011', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Handley Page Victor K2', nickname: '', subtitle: 'V-bomber and tanker aircraft, 1952–1993', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Avro Vulcan B2', nickname: '', subtitle: 'Delta-wing V-bomber operated 1956–1984', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Vickers Valiant', nickname: '', subtitle: 'First of the V-bombers, operated 1955–1965', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Gloster Javelin', nickname: '', subtitle: 'All-weather interceptor operated 1956–1967', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Hawker Hunter F6', nickname: '', subtitle: 'Swept-wing fighter operated 1954–1971', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'de Havilland Venom FB4', nickname: '', subtitle: 'Ground attack aircraft operated 1952–1962', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'de Havilland Vampire FB5', nickname: '', subtitle: 'Early jet aircraft and first jet trainer, 1945–1971', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Gloster Meteor F8', nickname: '', subtitle: 'First RAF jet fighter, operated 1944–1965', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Bristol Bloodhound', nickname: '', subtitle: 'Surface-to-air missile system operated 1958–1990', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Panavia Tornado GR4', nickname: 'Tonka', subtitle: 'Ground attack and interdictor aircraft, 1980–2019', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Panavia Tornado F3', nickname: '', subtitle: 'Air Defence Variant of the Tornado, 1985–2011', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Panavia Tornado GR1', nickname: 'Tonka', subtitle: 'Original Tornado ground attack version, 1980–2003', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'Hawker Siddeley Harrier GR1', nickname: 'Jump Jet', subtitle: 'VSTOL ground attack aircraft, operated 1969–2003', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },
  { title: 'BAE Harrier GR7/9', nickname: 'Jump Jet', subtitle: 'Second-generation VSTOL aircraft operated 1989–2010', category: 'Aircrafts', subcategory: 'Historic — Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Cold War' },

  // ── RAF AIRCRAFT — Historic: Post-Cold War ────────────────────────────────
  { title: 'Hawker Siddeley Nimrod MRA4', nickname: '', subtitle: 'Cancelled maritime patrol programme terminated in 2010', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'BAC VC10 K3/K4', nickname: '', subtitle: 'Strategic tanker aircraft operated 1966–2013', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'Lockheed Hercules C-130K', nickname: 'Herc', subtitle: 'Tactical transport aircraft operated 1967–2013', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'Lockheed Tristar K1/C2', nickname: '', subtitle: 'Tanker and transport aircraft operated 1983–2014', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'BAC TSR-2', nickname: '', subtitle: 'Advanced supersonic strike aircraft cancelled in 1965', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'Boeing E-3D Sentry AEW1', nickname: 'AWACS', subtitle: 'Airborne warning and control aircraft operated 1991–2021', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },
  { title: 'Raytheon Sentinel R1', nickname: 'Sentinel', subtitle: 'Ground surveillance aircraft operated 2008–2021', category: 'Aircrafts', subcategory: 'Historic — Post-Cold War', section: 'RAF AIRCRAFT', subsection: 'Historic — Post-Cold War' },

  // ── RAF AIRCRAFT — Historic: WWII ─────────────────────────────────────────
  { title: 'Supermarine Spitfire', nickname: '', subtitle: 'Iconic WWII RAF fighter, operated 1938–1954', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Hawker Hurricane', nickname: '', subtitle: 'Primary Battle of Britain fighter, operated 1937–1944', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Avro Lancaster B.I', nickname: '', subtitle: 'Heavy strategic bomber, operated 1942–1954', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'de Havilland Mosquito', nickname: 'Wooden Wonder', subtitle: 'Multi-role wooden aircraft known for versatility, 1941–1955', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Handley Page Halifax B.III', nickname: '', subtitle: 'Four-engine heavy bomber operated 1940–1945', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Short Stirling B.III', nickname: '', subtitle: 'First four-engine heavy bomber in RAF service, 1940–1946', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Bristol Blenheim IV', nickname: '', subtitle: 'Light bomber operated 1937–1944', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Bristol Beaufighter TF.X', nickname: '', subtitle: 'Night fighter and torpedo aircraft, operated 1940–1945', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Hawker Typhoon IB', nickname: '', subtitle: 'Ground attack aircraft operated 1941–1945', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Hawker Tempest V', nickname: '', subtitle: 'High-performance interceptor and ground attack aircraft, 1942–1951', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Vickers Wellington', nickname: '', subtitle: 'Medium bomber operated 1938–1953', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Armstrong Whitworth Whitley', nickname: '', subtitle: 'Early RAF heavy bomber operated 1937–1945', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Gloster Gladiator', nickname: '', subtitle: 'Last biplane fighter in RAF service, operated 1937–1944', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'Avro Anson', nickname: '', subtitle: 'Maritime patrol and trainer aircraft operated 1936–1968', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'de Havilland Tiger Moth', nickname: '', subtitle: 'Elementary flying training biplane, operated 1932–1952', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },
  { title: 'North American Harvard', nickname: '', subtitle: 'Advanced flying trainer operated 1939–1955', category: 'Aircrafts', subcategory: 'Historic — WWII', section: 'RAF AIRCRAFT', subsection: 'Historic — WWII' },

  // ── RAF BASES — UK Active ─────────────────────────────────────────────────
  { title: 'RAF Lossiemouth',   nickname: '',         subtitle: 'Scotland\'s primary fast jet and P-8A maritime patrol base', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Coningsby', nickname: '', subtitle: 'Lincolnshire Typhoon base, home of 29 OCU and Battle of Britain Memorial Flight', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Marham', nickname: '', subtitle: 'Norfolk base housing F-35B Lightning II, the UK\'s primary stealth jet base', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Brize Norton', nickname: '', subtitle: 'Oxfordshire tanker and transport hub: Voyager, A400M, C-17', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Waddington', nickname: '', subtitle: 'Lincolnshire ISR hub: RC-135W, Protector RG1, Shadow R1', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Odiham', nickname: '', subtitle: 'Hampshire Chinook support helicopter base', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Benson', nickname: '', subtitle: 'Oxfordshire base for Puma helicopter support operations', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Valley', nickname: '', subtitle: 'Anglesey, Wales — Hawk T2 advanced fast-jet training', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Shawbury', nickname: '', subtitle: 'Shropshire helicopter training base, home of Juno HT1 and Jupiter HT1', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Cranwell', nickname: '', subtitle: 'Lincolnshire — Initial Officer Training and Prefect T1 flying training', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Northolt', nickname: '', subtitle: 'West London — 32 Sqn Royal Squadron, joint civil and military airfield', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Leeming', nickname: '', subtitle: 'North Yorkshire — 100 Sqn Hawk adversary training and QRA support', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Wittering', nickname: '', subtitle: 'Cambridgeshire — No. 1 Air Control Centre and training units', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF High Wycombe', nickname: '', subtitle: 'Buckinghamshire — HQ Air Command, the RAF\'s nerve centre', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Honington', nickname: '', subtitle: 'Suffolk — RAF Regiment HQ and JTAC training centre', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Halton', nickname: '', subtitle: 'Buckinghamshire — recruit training and medical centre', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Cosford', nickname: '', subtitle: 'West Midlands — technical training and RAF Museum', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Digby', nickname: '', subtitle: 'Lincolnshire — SIGINT and intelligence gathering site', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Boulmer', nickname: '', subtitle: 'Northumberland — Air Surveillance and Control System hub', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Fylingdales', nickname: '', subtitle: 'North Yorkshire — Ballistic Missile Early Warning System', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Menwith Hill', nickname: '', subtitle: 'North Yorkshire — GCHQ/NSA intelligence gathering site', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Spadeadam', nickname: '', subtitle: 'Cumbria — Electronic Warfare Tactics Range', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Boscombe Down', nickname: '', subtitle: 'Wiltshire — test and evaluation centre, home of ETPS', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },
  { title: 'RAF Syerston', nickname: '', subtitle: 'Nottinghamshire — Air Cadet gliding centre', category: 'Bases', subcategory: 'UK Active', section: 'RAF BASES', subsection: 'UK Active' },

  // ── RAF BASES — UK Former ─────────────────────────────────────────────────
  { title: 'RAF Scampton', nickname: '', subtitle: 'Historic Red Arrows and Dambusters base in Lincolnshire, closed 2022', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Leuchars', nickname: '', subtitle: 'Former Tornado F3 and Typhoon base in Fife, now Army', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Kinloss', nickname: '', subtitle: 'Former Nimrod MR2 base in Moray, now Army Barracks', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Chivenor', nickname: '', subtitle: 'Former Hawk training base in Devon, now Royal Marines', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF St Mawgan', nickname: '', subtitle: 'Former Nimrod base in Cornwall, now civilian Newquay airport', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Gütersloh', nickname: '', subtitle: 'Germany BAOR base, closed 1993', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Laarbruch', nickname: '', subtitle: 'Germany Tornado base, closed 1999', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Brüggen', nickname: '', subtitle: 'Germany Tornado and Jaguar base, closed 2001', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Lyneham', nickname: '', subtitle: 'Wiltshire historic C-130 base, closed 2012', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Binbrook', nickname: '', subtitle: 'Lincolnshire Lightning interceptor base, closed 1988', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Cottesmore', nickname: '', subtitle: 'Rutland former Harrier and Tornado base, closed 2013', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },
  { title: 'RAF Abingdon', nickname: '', subtitle: 'Oxfordshire historic base, closed 1993', category: 'Bases', subcategory: 'UK Former', section: 'RAF BASES', subsection: 'UK Former' },

  // ── RAF BASES — Overseas Permanent ───────────────────────────────────────
  { title: 'RAF Akrotiri', nickname: '', subtitle: 'Cyprus Sovereign Base Area, strike element and eastern Mediterranean hub', category: 'Bases', subcategory: 'Overseas Permanent', section: 'RAF BASES', subsection: 'Overseas Permanent' },
  { title: 'RAF Dhekelia', nickname: '', subtitle: 'Cyprus Sovereign Base Area support site', category: 'Bases', subcategory: 'Overseas Permanent', section: 'RAF BASES', subsection: 'Overseas Permanent' },
  { title: 'RAF Mount Pleasant', nickname: 'MPA', subtitle: 'Falkland Islands — QRA Typhoon, P-8A and garrison base', category: 'Bases', subcategory: 'Overseas Permanent', section: 'RAF BASES', subsection: 'Overseas Permanent' },
  { title: 'RAF Ascension Island', nickname: '', subtitle: 'South Atlantic staging post and air bridge to the Falklands', category: 'Bases', subcategory: 'Overseas Permanent', section: 'RAF BASES', subsection: 'Overseas Permanent' },
  { title: 'RAF Gibraltar', nickname: '', subtitle: 'The Rock — patrol and staging base, joint military-civilian airfield', category: 'Bases', subcategory: 'Overseas Permanent', section: 'RAF BASES', subsection: 'Overseas Permanent' },

  // ── RAF BASES — Overseas Deployed / FOL ──────────────────────────────────
  { title: 'Al Udeid Air Base', nickname: '', subtitle: 'Qatar forward element for Op SHADER and CENTCOM operations', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Al Minhad Air Base', nickname: '', subtitle: 'UAE forward operating location for Gulf operations', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Muwaffaq Salti Air Base', nickname: '', subtitle: 'Jordan — Op SHADER staging base', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Gioia del Colle', nickname: '', subtitle: 'Italy — NATO base for RAF Typhoon deployments', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Mihail Kogalniceanu', nickname: '', subtitle: 'Romania — NATO Eastern Flank deployments', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Ämari Air Base', nickname: '', subtitle: 'Estonia — NATO Baltic Air Policing rotations', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Šiauliai Air Base', nickname: '', subtitle: 'Lithuania — NATO Baltic Air Policing, RAF Typhoon rotation', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Keflavik', nickname: '', subtitle: 'Iceland — NATO, RAF Typhoon air policing rotations', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'Decimomannu', nickname: '', subtitle: 'Sardinia — NATO ACM/ACMI range, regular RAF training', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Gan', nickname: '', subtitle: 'Maldives — historic Indian Ocean staging base, closed 1976', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Butterworth', nickname: '', subtitle: 'Malaysia — historic FPDA base, now RMAF', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Tengah', nickname: '', subtitle: 'Singapore — historic Far East Air Force base', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Hong Kong', nickname: '', subtitle: 'Historic RAF presence in Hong Kong, closed 1997', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Khormaksar', nickname: '', subtitle: 'Aden — historic RAF base, closed 1967', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  { title: 'RAF Habbaniyah', nickname: '', subtitle: 'Iraq — historic RAF base, operated 1930s–1959', category: 'Bases', subcategory: 'Overseas Deployed / FOL', section: 'RAF BASES', subsection: 'Overseas Deployed / FOL' },
  // ── TRAINING — Initial Training ───────────────────────────────────────────
  { title: 'Recruit Training', nickname: '', subtitle: 'Basic military training for new RAF recruits, conducted at RAF Halton', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },
  { title: 'Initial Officer Training', nickname: 'IOT', subtitle: 'RAFC Cranwell — 24-week commissioning course for new RAF officers', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },
  { title: 'Senior Officers\' War Course', nickname: '', subtitle: 'High-level PME course for senior RAF and joint officers', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },
  { title: 'Non-Commissioned Aircrew Training', nickname: '', subtitle: 'Initial training pathway for non-commissioned aircrew specialists', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },
  { title: 'Adult Recruit Training Course', nickname: '', subtitle: 'Basic military training course for adult entrants to the RAF', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },
  { title: 'Professionally Qualified Officers commissioning', nickname: '', subtitle: 'Direct entry commissioning route for professionally qualified specialists', category: 'Training', subcategory: 'Initial Training', section: 'TRAINING', subsection: 'Initial Training' },

  // ── TRAINING — Flying Training ────────────────────────────────────────────
  { title: 'Elementary Flying Training', nickname: 'EFT', subtitle: 'Initial fixed-wing flying training on the Grob Tutor T1', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Basic Flying Training', nickname: 'BFT', subtitle: 'Core flying training on the Grob Prefect T1 turboprop', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Advanced Flying Training Fixed Wing', nickname: '', subtitle: 'Advanced fast-jet training on the Hawk T2 at RAF Valley', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Multi-Engine Lead-In Training', nickname: '', subtitle: 'Transition training to multi-engine types using King Air and Avenger T1', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Rotary Wing Advanced Flying Training', nickname: '', subtitle: 'Advanced helicopter flying training at RAF Shawbury', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Fast Jet Lead-In Training', nickname: '', subtitle: 'Bridge training between advanced flying and operational conversion units', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Operational Conversion Unit', nickname: 'OCU', subtitle: 'Type-specific training converting aircrew to an operational aircraft', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Typhoon OCU', nickname: '', subtitle: 'Typhoon FGR4 conversion training, conducted by 29 Squadron at RAF Coningsby', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'F-35B OCU', nickname: '', subtitle: 'F-35B Lightning II conversion training by 207 Squadron at RAF Marham', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Chinook OCU', nickname: '', subtitle: 'Chinook heavy-lift helicopter conversion training by 18B Squadron', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Qualified Flying Instructor Course', nickname: 'QFI Course', subtitle: 'Central Flying School course qualifying pilots to instruct others', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Qualified Weapons Instructor Course', nickname: 'QWI Course', subtitle: 'Advanced course qualifying instructors in weapons and tactical employment', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },
  { title: 'Air Warfare Course', nickname: 'AWC', subtitle: 'Advanced joint air warfare training for senior aircrew and staff', category: 'Training', subcategory: 'Flying Training', section: 'TRAINING', subsection: 'Flying Training' },

  // ── TRAINING — Ground Training & PME ─────────────────────────────────────
  { title: 'Junior Command & Staff Course', nickname: '', subtitle: 'PME course for junior officers developing command and staff skills', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Advanced Command & Staff Course', nickname: 'ACSC', subtitle: 'Mid-level PME for officers approaching senior command', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Higher Command and Staff Course', nickname: 'HCSC', subtitle: 'Senior-level strategic leadership course at the Defence Academy', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Defence Academy courses', nickname: '', subtitle: 'Joint professional military education courses at Shrivenham', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'NATO School courses', nickname: '', subtitle: 'Alliance-wide training at NATO School Oberammergau, Germany', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Intelligence Analyst Training', nickname: '', subtitle: 'Specialist training for RAF intelligence analysts and officers', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Air Traffic Control Initial Training', nickname: '', subtitle: 'Foundation training for RAF Air Traffic Control Officers', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Explosive Ordnance Disposal Training', nickname: 'EOD Training', subtitle: 'Specialist training for RAF EOD technicians', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'RAF Regiment Basic Training', nickname: '', subtitle: 'Foundation military training for RAF Regiment gunners', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Combat Survival Training', nickname: 'SERE Level C', subtitle: 'Survival, evasion, resistance and extraction training for aircrew', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Resistance to Interrogation Training', nickname: 'RTI', subtitle: 'Training to resist interrogation techniques if captured', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Mountain Rescue Training', nickname: '', subtitle: 'Specialist training for RAF Mountain Rescue Team volunteers', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Cyber & Information Warfare Training', nickname: '', subtitle: 'Specialist training for RAF cyber and information operations roles', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },
  { title: 'Joint Personnel Recovery Training', nickname: 'JPR Training', subtitle: 'Training for personnel recovery and CSAR operations', category: 'Training', subcategory: 'Ground Training & PME', section: 'TRAINING', subsection: 'Ground Training & PME' },

  // ── TRAINING — Tactical & Combat Training ─────────────────────────────────
  { title: 'Air Combat Manoeuvring', nickname: 'ACM', subtitle: 'Tactical training in close air combat and dogfighting techniques', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Basic Fighter Manoeuvring', nickname: 'BFM', subtitle: 'Fundamental one-vs-one air combat manoeuvring training', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Dissimilar Air Combat Training', nickname: 'DACT', subtitle: 'Air combat training against dissimilar aircraft types to build tactical awareness', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Air-to-Air Refuelling Training', nickname: '', subtitle: 'Training for both tanker crews and receiver aircraft in AAR procedures', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Low-Level Flying Training', nickname: 'LLF', subtitle: 'Training in low-level fast jet and rotary wing operations', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Night Vision Goggle Flying', nickname: 'NVG Flying', subtitle: 'Training for helicopter and transport aircrew in NVG operations', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Electronic Warfare Training', nickname: 'EWTR', subtitle: 'Electronic warfare tactics training at RAF Spadeadam range', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Exercise Red Flag', nickname: '', subtitle: 'USAF Nellis-based large force employment exercise, highest-fidelity air warfare training', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Exercise Green Flag', nickname: '', subtitle: 'CAS-focused large force exercise at Nellis AFB', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Exercise Joint Warrior', nickname: '', subtitle: 'Large-scale joint maritime and air exercise held in Scotland', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Exercise Cobra Warrior', nickname: '', subtitle: 'International fast jet and EW exercise hosted at RAF Waddington', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'Exercise Frisian Flag', nickname: '', subtitle: 'International large force employment exercise held in the Netherlands', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },
  { title: 'JTAC Training and Certification', nickname: '', subtitle: 'Training and qualification of Joint Terminal Attack Controllers', category: 'Training', subcategory: 'Tactical & Combat Training', section: 'TRAINING', subsection: 'Tactical & Combat Training' },

  // ── THREATS — State Actor Air ─────────────────────────────────────────────
  { title: 'Russian Aerospace Forces', nickname: 'VKS', subtitle: 'Russia\'s unified air and space force, primary near-peer air threat to NATO', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Russian Long-Range Aviation', nickname: '', subtitle: 'Tu-95 Bear, Tu-160 Blackjack and Tu-22M Backfire — Russia\'s nuclear bomber fleet', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Sukhoi Su-27 Flanker family', nickname: 'Flanker', subtitle: 'Russia\'s primary fighter family, widely exported and combat-proven', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Mikoyan MiG-29 Fulcrum', nickname: 'Fulcrum', subtitle: 'Russian twin-engine tactical fighter, operated by multiple adversary states', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Mikoyan MiG-31 Foxhound', nickname: 'Foxhound', subtitle: 'High-speed interceptor capable of Mach 2.83, carrier of Kinzhal missile', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Sukhoi Su-57 Felon', nickname: 'Felon', subtitle: 'Russia\'s 5th generation stealth multirole fighter', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Chinese PLAAF', nickname: 'PLAAF', subtitle: 'People\'s Liberation Army Air Force — growing peer threat in Indo-Pacific', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Chengdu J-20 Mighty Dragon', nickname: 'Mighty Dragon', subtitle: 'China\'s 5th generation stealth fighter, PLAAF primary advanced platform', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Shenyang J-16', nickname: '', subtitle: 'Chinese multirole strike fighter derived from the Su-27 family', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'North Korean Air Force', nickname: 'KPAF', subtitle: 'Legacy Soviet-era aircraft fleet with growing ballistic missile threat', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },
  { title: 'Iranian Air Force', nickname: 'IRIAF', subtitle: 'Ageing mix of US and Russian aircraft with significant drone and missile capability', category: 'Threats', subcategory: 'State Actor Air', section: 'THREATS', subsection: 'State Actor Air' },

  // ── THREATS — Surface-to-Air Missiles ────────────────────────────────────
  { title: 'S-400 Triumf', nickname: 'SA-21 Growler', subtitle: 'Russian long-range surface-to-air missile system, range 400km+', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'S-300 family', nickname: 'SA-10/SA-20', subtitle: 'Russian long-range SAM family — SA-10 Grumble and SA-20 Gargoyle variants', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'Pantsir-S1/S2', nickname: 'SA-22 Greyhound', subtitle: 'Russian short-range combined gun and missile air defence system', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'Buk-M2/M3', nickname: 'SA-17 Grizzly', subtitle: 'Russian medium-range surface-to-air missile system', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'Tor-M2', nickname: 'SA-15 Gauntlet', subtitle: 'Russian short-range tactical surface-to-air missile system', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'HQ-9', nickname: '', subtitle: 'Chinese long-range surface-to-air missile, broadly equivalent to S-300', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },
  { title: 'MANPADS', nickname: '', subtitle: 'Man-Portable Air Defence Systems — shoulder-launched SAMs SA-7 through SA-24', category: 'Threats', subcategory: 'Surface-to-Air Missiles', section: 'THREATS', subsection: 'Surface-to-Air Missiles' },

  // ── THREATS — Asymmetric & Non-State ─────────────────────────────────────
  { title: 'ISIS / Daesh', nickname: 'Daesh', subtitle: 'Non-state actor using drones, IEDs and targeting of air assets', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Al-Qaeda affiliates', nickname: '', subtitle: 'AQAP and AQIM affiliates operating in Yemen and North Africa', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Houthi movement', nickname: '', subtitle: 'Yemen-based group using ballistic missiles, cruise missiles and drones', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Iranian Shahed-136 loitering munition', nickname: 'Shahed-136', subtitle: 'Iranian kamikaze drone used extensively in Ukraine and by Houthi forces', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Hezbollah', nickname: '', subtitle: 'Lebanese militia with significant drone and precision missile capability', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Small Commercial UAS threat', nickname: '', subtitle: 'Commercial drones weaponised or used for ISR by non-state actors', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },
  { title: 'Wagner Group / Russian PMC', nickname: 'Wagner', subtitle: 'Russian private military company operating in Africa and Ukraine', category: 'Threats', subcategory: 'Asymmetric & Non-State', section: 'THREATS', subsection: 'Asymmetric & Non-State' },

  // ── THREATS — Missiles & Stand-Off ───────────────────────────────────────
  { title: 'Russian Kh-101 air-launched cruise missile', nickname: 'Kh-101', subtitle: 'Russian long-range stealthy air-launched cruise missile, range 5,000km+', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Russian Kalibr sea-launched cruise missile', nickname: 'Kalibr', subtitle: 'Russian precision sea-launched cruise missile used extensively in Ukraine', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Russian Iskander-M ballistic / cruise missile', nickname: 'Iskander', subtitle: 'Russian short-range ballistic and cruise missile system, range 500km', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Russian Kinzhal hypersonic air-launched ballistic missile', nickname: 'Kinzhal', subtitle: 'Mach 10+ hypersonic air-launched ballistic missile carried by MiG-31', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Russian Zircon hypersonic cruise missile', nickname: 'Zircon', subtitle: 'Russian ship-launched hypersonic cruise missile, Mach 8+', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Chinese DF-21D anti-ship ballistic missile', nickname: 'DF-21D', subtitle: 'Chinese carrier-killer ballistic missile, range 1,500km+', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Iranian Shahab ballistic missile family', nickname: 'Shahab', subtitle: 'Iranian medium-range ballistic missile series derived from North Korean designs', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },
  { title: 'Anti-radiation missiles', nickname: 'ARM', subtitle: 'HARM and Kh-31P missiles that home onto radar emissions to destroy SAM sites', category: 'Threats', subcategory: 'Missiles & Stand-Off', section: 'THREATS', subsection: 'Missiles & Stand-Off' },

  // ── THREATS — Electronic & Cyber ──────────────────────────────────────────
  { title: 'Russian GRU cyber operations', nickname: '', subtitle: 'Russian military intelligence cyber operations targeting Western infrastructure', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },
  { title: 'Electronic warfare jamming of GPS / datalinks', nickname: '', subtitle: 'Adversary jamming of GPS and tactical datalinks degrading precision and comms', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },
  { title: 'GPS spoofing', nickname: '', subtitle: 'False GPS signals threatening precision-guided munitions and navigation', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },
  { title: 'SATCOM jamming', nickname: '', subtitle: 'Russian Krasukha EW systems jamming satellite communications', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },
  { title: 'Anti-Satellite weapons', nickname: 'ASAT', subtitle: 'Russia Nudol and Chinese SC-19 direct-ascent anti-satellite missiles', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },
  { title: 'Directed Energy Weapons targeting aircraft sensors', nickname: 'DEW', subtitle: 'Laser and high-power microwave weapons designed to blind or damage aircraft sensors', category: 'Threats', subcategory: 'Electronic & Cyber', section: 'THREATS', subsection: 'Electronic & Cyber' },

  // ── ALLIES — NATO ─────────────────────────────────────────────────────────
  { title: 'United States Air Force', nickname: 'USAF', subtitle: 'Primary allied air force, extensive joint operations with the RAF globally', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'French Air and Space Force', nickname: 'Armee de l\'Air', subtitle: 'Lancaster House defence partner, operates Rafale and nuclear capability', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'German Air Force / Luftwaffe', nickname: 'Luftwaffe', subtitle: 'Eurofighter partner nation, procuring F-35A for nuclear sharing role', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Italian Air Force', nickname: 'AMI', subtitle: 'Eurofighter partner and F-35A operator, NATO southern flank', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Royal Netherlands Air Force', nickname: 'RNLAF', subtitle: 'F-35A operator with NATO Baltic Air Policing rotations', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Royal Norwegian Air Force', nickname: 'RNoAF', subtitle: 'F-35A operator, key northern flank partner in the GIUK Gap', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Royal Danish Air Force', nickname: 'RDAF', subtitle: 'F-35A operator with Baltic Air Policing and Arctic responsibilities', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Polish Air Force', nickname: '', subtitle: 'F-35A operator on NATO\'s Eastern Flank, front-line against Russian threat', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Turkish Air Force', nickname: 'TurAF', subtitle: 'F-16 operator and NATO southern anchor, key Bosphorus strategic position', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Spanish Air Force', nickname: 'EdA', subtitle: 'Eurofighter operator, NATO southern flank contributor', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Greek Hellenic Air Force', nickname: 'HAF', subtitle: 'F-16 operator with NATO AOR responsibilities in Aegean and Eastern Med', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Romanian Air Force', nickname: '', subtitle: 'F-16 operator on NATO\'s Eastern Flank, Black Sea region', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },
  { title: 'Canadian Royal Air Force', nickname: 'RCAF', subtitle: 'CF-18 and future F-35A operator, NORAD partner and Five Eyes member', category: 'Allies', subcategory: 'NATO', section: 'ALLIES', subsection: 'NATO' },

  // ── ALLIES — Five Eyes ────────────────────────────────────────────────────
  { title: 'United States Intelligence Community', nickname: 'USIC', subtitle: 'Seventeen US intelligence agencies sharing SIGINT and analysis with Five Eyes', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },
  { title: 'Canada', nickname: 'RCAF / CSE', subtitle: 'RCAF and Communications Security Establishment, continental defence via NORAD', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },
  { title: 'Australia', nickname: 'RAAF / ASD', subtitle: 'RAAF and Australian Signals Directorate, Indo-Pacific and AUKUS partner', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },
  { title: 'New Zealand', nickname: 'RNZAF / GCSB', subtitle: 'RNZAF and GCSB Five Eyes Pacific intelligence partner', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },
  { title: 'Five Eyes Alliance', nickname: 'FVEY', subtitle: 'UKUSA-based intelligence-sharing partnership between UK, US, Canada, Australia, NZ', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },
  { title: 'ECHELON', nickname: '', subtitle: 'Global SIGINT collection network operated by Five Eyes nations', category: 'Allies', subcategory: 'Five Eyes', section: 'ALLIES', subsection: 'Five Eyes' },

  // ── ALLIES — AUKUS ────────────────────────────────────────────────────────
  { title: 'AUKUS Pillar 1', nickname: '', subtitle: 'SSN-AUKUS nuclear-powered submarine programme for Australia', category: 'Allies', subcategory: 'AUKUS', section: 'ALLIES', subsection: 'AUKUS' },
  { title: 'AUKUS Pillar 2', nickname: '', subtitle: 'Trilateral advanced capabilities programme: AI, quantum, cyber, hypersonics, EW', category: 'Allies', subcategory: 'AUKUS', section: 'ALLIES', subsection: 'AUKUS' },

  // ── ALLIES — Bilateral & Framework Partners ────────────────────────────────
  { title: 'UK-France Defence Partnership', nickname: '', subtitle: 'Bilateral defence cooperation under the 2010 Lancaster House Treaties framework', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Joint Expeditionary Force', nickname: 'JEF', subtitle: 'UK-led coalition of 10 northern European nations for rapid deployment', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Japan Air Self-Defense Force', nickname: 'JASDF', subtitle: 'GCAP and Tempest partner, growing interoperability with the RAF', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'FPDA Partnership', nickname: 'FPDA', subtitle: 'UK, Australia, NZ, Malaysia, Singapore mutual defence framework', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Gulf Cooperation Council states', nickname: 'GCC', subtitle: 'Qatar, UAE, Saudi Arabia — RAF basing and access partners', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Kingdom of Saudi Arabia', nickname: 'RSAF', subtitle: 'Royal Saudi Air Force — Typhoon customer and regional partner', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'United Arab Emirates Air Force', nickname: 'UAEAF', subtitle: 'Typhoon and F-35 customer, Al Minhad host nation', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Qatar Emiri Air Force', nickname: 'QEAF', subtitle: 'Typhoon customer and Al Udeid Air Base host nation', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'Kingdom of Jordan', nickname: '', subtitle: 'F-16 operator and Op SHADER base access partner', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },
  { title: 'India Air Force', nickname: 'IAF', subtitle: 'Jaguar heritage nation with growing bilateral air exercise programme', category: 'Allies', subcategory: 'Bilateral & Framework Partners', section: 'ALLIES', subsection: 'Bilateral & Framework Partners' },

  // ── MISSIONS — World War I ────────────────────────────────────────────────
  { title: 'Royal Flying Corps', nickname: 'RFC', subtitle: 'British military air service predecessor to the RAF, formed 1912', category: 'Missions', subcategory: 'World War I', section: 'MISSIONS', subsection: 'World War I' },
  { title: 'RAF Formation 1 April 1918', nickname: '', subtitle: 'Merger of RFC and RNAS creating the world\'s first independent air force', category: 'Missions', subcategory: 'World War I', section: 'MISSIONS', subsection: 'World War I' },
  { title: 'Battle of Cambrai', nickname: '', subtitle: 'First large-scale air-ground cooperation operation, November 1917', category: 'Missions', subcategory: 'World War I', section: 'MISSIONS', subsection: 'World War I' },

  // ── MISSIONS — World War II ───────────────────────────────────────────────
  { title: 'Battle of Britain', nickname: '', subtitle: 'RAF aerial defence of the UK against Luftwaffe, 10 July – 31 October 1940', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Operation CHASTISE', nickname: 'Dambusters Raid', subtitle: '617 Sqn bouncing bomb attack on Ruhr dams, 16/17 May 1943', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Bomber Command Strategic Campaign 1939–1945', nickname: '', subtitle: 'RAF strategic bombing campaign against Germany throughout WWII', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Operation OVERLORD', nickname: '', subtitle: 'RAF air superiority operations supporting D-Day landings, June 1944', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Operation MARKET GARDEN', nickname: '', subtitle: 'Arnhem airborne assault and resupply operations, September 1944', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Operation MANNA', nickname: '', subtitle: 'RAF food drops to starving Dutch population, May 1945', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Desert Air Force', nickname: '', subtitle: 'Allied tactical air force supporting North Africa campaign 1940–1943', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Malta Air Defence', nickname: '', subtitle: 'RAF defence of Malta against Axis air assault, 1940–1942', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Battle of the Atlantic', nickname: '', subtitle: 'Coastal Command maritime patrol operations against U-boats', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },
  { title: 'Pathfinder Force', nickname: '', subtitle: '8 Group precision target marking unit guiding Bomber Command raids', category: 'Missions', subcategory: 'World War II', section: 'MISSIONS', subsection: 'World War II' },

  // ── MISSIONS — Post-War & Cold War ────────────────────────────────────────
  { title: 'Berlin Airlift', nickname: 'Operation PLAINFARE', subtitle: 'RAF contribution to the Allied airlift breaking the Soviet Berlin blockade, 1948–1949', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Korean War', nickname: '', subtitle: 'RAF pilots seconded to USAF flying Meteors and Sabres, 1950–1953', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Suez Crisis', nickname: 'Operation MUSKETEER', subtitle: 'Anglo-French air operations against Egypt, 1956', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Malayan Emergency', nickname: '', subtitle: 'RAF counter-insurgency air operations in Malaya, 1948–1960', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Falklands War', nickname: 'Operation CORPORATE', subtitle: 'RAF air operations during recovery of the Falkland Islands, 1982', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Operation BLACK BUCK', nickname: '', subtitle: 'Vulcan long-range bombing raids on Port Stanley airfield, 1982', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },
  { title: 'Aden / South Arabia', nickname: '', subtitle: 'RAF Hawker Hunter ground attack operations during withdrawal, 1963–1967', category: 'Missions', subcategory: 'Post-War & Cold War', section: 'MISSIONS', subsection: 'Post-War & Cold War' },

  // ── MISSIONS — Post-Cold War ──────────────────────────────────────────────
  { title: 'Gulf War', nickname: 'Operation GRANBY', subtitle: 'RAF Tornado and other operations in Operation Desert Storm, 1990–1991', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },
  { title: 'Operation WARDEN', nickname: '', subtitle: 'Northern Iraq No-Fly Zone enforcement, 1991–2003', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },
  { title: 'Operation DENY FLIGHT', nickname: '', subtitle: 'Bosnia-Herzegovina No-Fly Zone enforcement, 1993–1995', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },
  { title: 'Operation DELIBERATE FORCE', nickname: '', subtitle: 'NATO air strikes against Bosnian Serb forces, 1995', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },
  { title: 'Operation ALLIED FORCE', nickname: '', subtitle: 'NATO air campaign over Kosovo and Serbia, 1999', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },
  { title: 'Operation PALLISER', nickname: '', subtitle: 'UK intervention in Sierra Leone supporting UN mission, 2000', category: 'Missions', subcategory: 'Post-Cold War', section: 'MISSIONS', subsection: 'Post-Cold War' },

  // ── MISSIONS — War on Terror ──────────────────────────────────────────────
  { title: 'Operation HERRICK', nickname: '', subtitle: 'RAF operations in Afghanistan, 2002–2014', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },
  { title: 'Operation TELIC', nickname: '', subtitle: 'RAF operations in Iraq, 2003–2009', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },
  { title: 'Operation ELLAMY', nickname: '', subtitle: 'RAF air operations supporting NATO in Libya, 2011', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },
  { title: 'Operation SHADER', nickname: '', subtitle: 'RAF counter-Daesh operations in Iraq and Syria, 2014–present', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },
  { title: 'Operation PITTING', nickname: '', subtitle: 'RAF evacuation of civilians from Kabul, Afghanistan, August 2021', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },
  { title: 'Operation GOLDEN ORB', nickname: '', subtitle: 'RAF evacuation of British nationals from Sudan, April 2023', category: 'Missions', subcategory: 'War on Terror', section: 'MISSIONS', subsection: 'War on Terror' },

  // ── MISSIONS — NATO Standing Operations ──────────────────────────────────
  { title: 'NATO Baltic Air Policing', nickname: '', subtitle: 'RAF Typhoon rotations policing Baltic NATO airspace from Lithuania and Estonia', category: 'Missions', subcategory: 'NATO Standing Operations', section: 'MISSIONS', subsection: 'NATO Standing Operations' },
  { title: 'NATO Icelandic Air Policing', nickname: '', subtitle: 'RAF Typhoon rotations at Keflavik policing Icelandic airspace', category: 'Missions', subcategory: 'NATO Standing Operations', section: 'MISSIONS', subsection: 'NATO Standing Operations' },
  { title: 'Operation AZALEA', nickname: '', subtitle: 'RAF standing air defence patrol of the Falkland Islands', category: 'Missions', subcategory: 'NATO Standing Operations', section: 'MISSIONS', subsection: 'NATO Standing Operations' },
  { title: 'Operation KIPION', nickname: '', subtitle: 'UK standing maritime presence in the Gulf region', category: 'Missions', subcategory: 'NATO Standing Operations', section: 'MISSIONS', subsection: 'NATO Standing Operations' },
  { title: 'NATO Enhanced Forward Presence', nickname: 'eFP', subtitle: 'NATO air elements deployed to Baltic States and Poland on Eastern Flank', category: 'Missions', subcategory: 'NATO Standing Operations', section: 'MISSIONS', subsection: 'NATO Standing Operations' },

  // ── MISSIONS — Humanitarian & NEO ────────────────────────────────────────
  { title: 'Operation PATWIN', nickname: '', subtitle: 'RAF humanitarian air operations supporting Pakistan flood relief, 2010', category: 'Missions', subcategory: 'Humanitarian & NEO', section: 'MISSIONS', subsection: 'Humanitarian & NEO' },
  { title: 'Caribbean hurricane relief operations', nickname: '', subtitle: 'RAF airlift and humanitarian support following Caribbean hurricanes', category: 'Missions', subcategory: 'Humanitarian & NEO', section: 'MISSIONS', subsection: 'Humanitarian & NEO' },
  { title: 'COVID-19 medical logistics operations', nickname: '', subtitle: 'RAF strategic airlift of medical equipment and PPE during COVID-19 pandemic', category: 'Missions', subcategory: 'Humanitarian & NEO', section: 'MISSIONS', subsection: 'Humanitarian & NEO' },

  // ── TECHNOLOGY — Weapons Systems ─────────────────────────────────────────
  { title: 'Brimstone 2/3', nickname: 'Brimstone', subtitle: 'RAF dual-mode seeker stand-off missile, low collateral damage', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'MBDA Meteor BVRAAM', nickname: 'Meteor', subtitle: 'Ramjet-powered beyond-visual-range air-to-air missile, no-escape zone', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'ASRAAM / AIM-132', nickname: 'ASRAAM', subtitle: 'Advanced short-range air-to-air missile, highly agile IR seeker', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'Storm Shadow / SCALP-EG', nickname: 'Storm Shadow', subtitle: 'Stand-off cruise missile with 500km+ range for deep strike', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'SPEAR 3 / MBDA SPEAR', nickname: 'SPEAR 3', subtitle: 'Powered precision network-enabled stand-off strike weapon, entering service', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'Paveway IV', nickname: '', subtitle: 'Dual-mode GPS and laser-guided bomb, the RAF\'s standard precision weapon', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'Harpoon anti-ship missile', nickname: 'Harpoon', subtitle: 'Anti-ship missile carried by P-8A Poseidon for maritime strike', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'Stingray torpedo', nickname: 'Stingray', subtitle: 'Lightweight air-launched anti-submarine torpedo carried by P-8A', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },
  { title: 'AIM-120 AMRAAM', nickname: 'AMRAAM', subtitle: 'Beyond-visual-range active radar air-to-air missile carried by F-35B', category: 'Tech', subcategory: 'Weapons Systems', section: 'TECHNOLOGY', subsection: 'Weapons Systems' },

  // ── TECHNOLOGY — Sensors & Avionics ──────────────────────────────────────
  { title: 'Captor-E AESA Radar', nickname: 'ECRS Mk1/Mk2', subtitle: 'Active electronically scanned array radar upgrade for Typhoon', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'AN/APG-81 AESA Radar', nickname: '', subtitle: 'F-35B active electronically scanned array main radar', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'AN/AAQ-40 EOTS', nickname: 'EOTS', subtitle: 'F-35B Electro-Optical Targeting System for precision targeting', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'AN/AAQ-37 DAS', nickname: 'DAS', subtitle: 'F-35B Distributed Aperture System providing 360-degree infrared awareness', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'LITENING III/IV Targeting Pod', nickname: 'LITENING', subtitle: 'Electro-optical and laser targeting pod carried by Typhoon', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'Shadow R1 sensor suite', nickname: '', subtitle: 'Wide-area ISR sensor payload on the Beechcraft Shadow R1', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'P-8A Poseidon acoustic sensors', nickname: '', subtitle: 'Sonobuoys and magnetic anomaly detector for submarine detection', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'RC-135W Rivet Joint SIGINT systems', nickname: '', subtitle: 'Comprehensive signals intelligence collection suite on the RC-135W', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'E-7A Wedgetail MESA radar', nickname: 'MESA', subtitle: 'Multi-role Electronically Scanned Array radar for airborne battle management', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },
  { title: 'Striker II Helmet Mounted Display', nickname: 'Striker II', subtitle: 'F-35B advanced helmet-mounted display and night-vision system', category: 'Tech', subcategory: 'Sensors & Avionics', section: 'TECHNOLOGY', subsection: 'Sensors & Avionics' },

  // ── TECHNOLOGY — Electronic Warfare ──────────────────────────────────────
  { title: 'BriteCloud Expendable Active Decoy', nickname: 'BriteCloud', subtitle: 'First RAF expendable active decoy, carried by Typhoon', category: 'Tech', subcategory: 'Electronic Warfare', section: 'TECHNOLOGY', subsection: 'Electronic Warfare' },
  { title: 'Praetorian DASS', nickname: 'Praetorian', subtitle: 'Typhoon Defensive Aids Sub-System for self-protection', category: 'Tech', subcategory: 'Electronic Warfare', section: 'TECHNOLOGY', subsection: 'Electronic Warfare' },
  { title: 'Chaff and Flare dispensing systems', nickname: '', subtitle: 'Passive countermeasures dispensed to decoy radar and IR-guided missiles', category: 'Tech', subcategory: 'Electronic Warfare', section: 'TECHNOLOGY', subsection: 'Electronic Warfare' },
  { title: 'Radar Warning Receivers', nickname: 'RWR', subtitle: 'Onboard systems detecting and classifying radar-guided missile threats', category: 'Tech', subcategory: 'Electronic Warfare', section: 'TECHNOLOGY', subsection: 'Electronic Warfare' },
  { title: 'RAF Spadeadam EWTR', nickname: '', subtitle: 'Electronic Warfare Tactics Range at RAF Spadeadam, Cumbria', category: 'Tech', subcategory: 'Electronic Warfare', section: 'TECHNOLOGY', subsection: 'Electronic Warfare' },

  // ── TECHNOLOGY — Future Programmes ───────────────────────────────────────
  { title: 'GCAP / Global Combat Air Programme', nickname: 'GCAP', subtitle: 'UK, Japan and Italy 6th-generation combat aircraft, in service 2035', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'Tempest demonstrator', nickname: 'Tempest', subtitle: 'BAE Systems technology demonstrator preceding GCAP', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'Dragonfire directed energy laser weapon', nickname: 'Dragonfire', subtitle: '50kW-class laser weapon for counter-UAS and future combat aircraft', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'Autonomous Collaborative Platforms', nickname: 'ACP', subtitle: 'RAF loyal wingman and uncrewed teaming concept for future operations', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'ECRS Mk2 Radar', nickname: '', subtitle: 'Typhoon Block 20 electronic attack radar with jamming capability', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'F-35B Block 4 upgrade', nickname: '', subtitle: 'New weapons integration, software and sensor fusion upgrade for F-35B', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },
  { title: 'AI-assisted mission planning', nickname: 'Project CORTEX', subtitle: 'RAF AI project for automated mission planning and intelligence fusion', category: 'Tech', subcategory: 'Future Programmes', section: 'TECHNOLOGY', subsection: 'Future Programmes' },

  // ── TECHNOLOGY — Command, Control & Comms ────────────────────────────────
  { title: 'Link 16 Tactical Data Link', nickname: 'Link 16', subtitle: 'Real-time air picture sharing datalink used across NATO air forces', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },
  { title: 'SKYNET 5/6', nickname: 'SKYNET', subtitle: 'UK military satellite communications system', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },
  { title: 'Morpheus', nickname: '', subtitle: 'UK future tactical communications programme replacing Bowman', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },
  { title: 'NATO ACCS', nickname: '', subtitle: 'NATO Air Command and Control System for integrated airspace management', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },
  { title: 'Combined Air Operations Centre', nickname: 'CAOC', subtitle: 'NATO CAOC Uedem and Torrejon managing Allied air operations', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },
  { title: 'ISTAR fusion at RAF Waddington', nickname: '', subtitle: 'Multi-source intelligence fusion centre at the RAF\'s ISR hub', category: 'Tech', subcategory: 'Command, Control & Comms', section: 'TECHNOLOGY', subsection: 'Command, Control & Comms' },

  // ── TERMINOLOGY — Operational Concepts ───────────────────────────────────
  { title: 'Quick Reaction Alert', nickname: 'QRA', subtitle: '24/7 intercept readiness — fighters at 10-min scramble state', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Combat Air Patrol', nickname: 'CAP', subtitle: 'Sustained fighter patrol protecting a defined area from air attack', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Defensive Counter Air', nickname: 'DCA', subtitle: 'Operations defending friendly forces and assets from air attack', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Offensive Counter Air', nickname: 'OCA', subtitle: 'Operations attacking enemy air forces and their support infrastructure', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Close Air Support', nickname: 'CAS', subtitle: 'Air action against hostile targets close to friendly forces', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Air Interdiction', nickname: 'AI', subtitle: 'Air action against targets beyond close support range to disrupt enemy', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Suppression of Enemy Air Defences', nickname: 'SEAD', subtitle: 'Operations to degrade, neutralise or destroy enemy surface-based air defences', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Destruction of Enemy Air Defences', nickname: 'DEAD', subtitle: 'Permanent physical destruction of enemy air defence systems', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Air-to-Air Refuelling', nickname: 'AAR', subtitle: 'In-flight fuel transfer extending aircraft range and endurance', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Airborne Early Warning & Control', nickname: 'AEW&C', subtitle: 'Airborne radar and battle management providing the air picture', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'ISTAR', nickname: '', subtitle: 'Intelligence, Surveillance, Target Acquisition and Reconnaissance', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Combat Search and Rescue', nickname: 'CSAR', subtitle: 'Recovery of personnel from hostile or denied environments', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Non-Combatant Evacuation Operations', nickname: 'NEO', subtitle: 'Rapid extraction of civilians and non-combatants from threatened areas', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'Humanitarian Assistance / Disaster Relief', nickname: 'HADR', subtitle: 'RAF air operations providing humanitarian and disaster relief', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },
  { title: 'COMAO', nickname: '', subtitle: 'Combined Air Operations — coordinated multi-type air package', category: 'Terminology', subcategory: 'Operational Concepts', section: 'TERMINOLOGY', subsection: 'Operational Concepts' },

  // ── TERMINOLOGY — Flying & Tactical ──────────────────────────────────────
  { title: 'Sortie', nickname: '', subtitle: 'A single operational mission flight by one aircraft', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Strike Package', nickname: '', subtitle: 'A coordinated package of aircraft assigned to a single strike mission', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Vul Time', nickname: '', subtitle: 'Vulnerability time — the window a target is exposed to attack', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'TOT', nickname: 'Time on Target', subtitle: 'Planned time when ordnance is to impact the target', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Fence In / Fence Out', nickname: '', subtitle: 'Cockpit weapons and systems checks at the combat area boundary', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Bingo Fuel', nickname: '', subtitle: 'Fuel state requiring immediate return to base or divert airfield', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Joker Fuel', nickname: '', subtitle: 'Fuel level triggering an abort or divert decision', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Winchester', nickname: '', subtitle: 'Radio call indicating all ordnance has been expended', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Tally', nickname: '', subtitle: 'Visual contact with a target aircraft or object confirmed', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'No Joy', nickname: '', subtitle: 'No visual contact with the target or aircraft', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Judy', nickname: '', subtitle: 'Fighter pilot confirms taking control of an intercept', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Bogey', nickname: '', subtitle: 'An unidentified aircraft contact requiring investigation', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Bandit', nickname: '', subtitle: 'A confirmed hostile aircraft', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Fox 1', nickname: '', subtitle: 'Radio call indicating a semi-active radar missile has been fired', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Fox 2', nickname: '', subtitle: 'Radio call indicating an infrared-guided missile has been fired', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Fox 3', nickname: '', subtitle: 'Radio call indicating an active radar missile has been fired', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Splash', nickname: '', subtitle: 'Confirmation that a target has been destroyed', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Knock it off', nickname: '', subtitle: 'Command to immediately cease air combat manoeuvring', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'Break', nickname: '', subtitle: 'Command for an immediate hard defensive turn against a threat', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'G-LOC', nickname: '', subtitle: 'G-force induced Loss Of Consciousness — serious threat in high-g manoeuvres', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },
  { title: 'HOTAS', nickname: '', subtitle: 'Hands On Throttle And Stick — cockpit control philosophy', category: 'Terminology', subcategory: 'Flying & Tactical', section: 'TERMINOLOGY', subsection: 'Flying & Tactical' },

  // ── TERMINOLOGY — Air Traffic & Navigation ────────────────────────────────
  { title: 'NOTAM', nickname: '', subtitle: 'Notice To Airmen — official notice of airspace hazards or restrictions', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'METAR', nickname: '', subtitle: 'Meteorological Aerodrome Report — standard weather observation format', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'IFR / VFR', nickname: '', subtitle: 'Instrument Flight Rules and Visual Flight Rules — governing conditions for flight', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'RVSM', nickname: '', subtitle: 'Reduced Vertical Separation Minima — 1,000ft separation above FL290', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'TACAN', nickname: '', subtitle: 'Tactical Air Navigation System — military bearing and distance navigation aid', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'ILS', nickname: '', subtitle: 'Instrument Landing System — precision approach aid for low visibility', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'GCA', nickname: '', subtitle: 'Ground Controlled Approach — radar-guided landing in poor visibility', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'MATZ', nickname: '', subtitle: 'Military Aerodrome Traffic Zone — protected airspace around RAF stations', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'ADIZ', nickname: '', subtitle: 'Air Defence Identification Zone — airspace requiring identification of all aircraft', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'MAYDAY / PAN PAN', nickname: '', subtitle: 'International aviation emergency and urgency distress signals', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'Squawk / Squawk IDENT', nickname: '', subtitle: 'Transponder code assignment and identification procedures', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },
  { title: 'Zulu Time', nickname: '', subtitle: 'UTC — all RAF and NATO operations are conducted in Zulu time', category: 'Terminology', subcategory: 'Air Traffic & Navigation', section: 'TERMINOLOGY', subsection: 'Air Traffic & Navigation' },

  // ── TERMINOLOGY — Intelligence & Planning ─────────────────────────────────
  { title: 'HUMINT', nickname: '', subtitle: 'Human Intelligence — intelligence gathered from human sources', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'SIGINT', nickname: '', subtitle: 'Signals Intelligence — intelligence from intercepted communications and emissions', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'IMINT', nickname: '', subtitle: 'Imagery Intelligence — intelligence derived from imagery and photography', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'OSINT', nickname: '', subtitle: 'Open Source Intelligence — intelligence from publicly available sources', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'ELINT', nickname: '', subtitle: 'Electronic Intelligence — intelligence from enemy electronic emissions', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'PID', nickname: 'Positive Identification', subtitle: 'Positive Identification — legally required before weapon release', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'CDE', nickname: 'Collateral Damage Estimation', subtitle: 'Collateral Damage Estimation — legal and proportionality assessment before strike', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'ROE', nickname: 'Rules of Engagement', subtitle: 'Rules of Engagement — directives defining when force may be used', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'LOAC', nickname: 'Law of Armed Conflict', subtitle: 'Law of Armed Conflict — legal framework governing conduct in war', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'CONOPS', nickname: '', subtitle: 'Concept of Operations — document outlining how an operation will be conducted', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'OPORD', nickname: '', subtitle: 'Operations Order — detailed directive for executing a military operation', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'FRAGORD', nickname: '', subtitle: 'Fragmentary Order — amendment or supplement to an existing OPORD', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'Pattern of Life', nickname: '', subtitle: 'Intelligence analysis technique tracking movement and activity over time', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },
  { title: 'No-Strike List', nickname: 'NSL', subtitle: 'List of protected targets that must not be struck under LOAC', category: 'Terminology', subcategory: 'Intelligence & Planning', section: 'TERMINOLOGY', subsection: 'Intelligence & Planning' },

  // ── TERMINOLOGY — Maintenance & Support ───────────────────────────────────
  { title: 'Line Servicing / Line Maintenance', nickname: '', subtitle: 'Day-to-day aircraft servicing and turnaround on the flight line', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Aircraft on Ground', nickname: 'AOG', subtitle: 'Aircraft grounded and unserviceable, requiring urgent repair', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Fly-to-Plan rate', nickname: '', subtitle: 'Aircraft availability metric measuring percentage of sorties flown as planned', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Form 700', nickname: '', subtitle: 'RAF aircraft maintenance record — the legal airworthiness document', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Military Aviation Authority', nickname: 'MAA', subtitle: 'UK military airworthiness regulator overseeing RAF aircraft safety', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Release to Service', nickname: 'RTS', subtitle: 'Formal authority to operate an aircraft or system in service', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Life Extension Programme', nickname: 'LIFEX', subtitle: 'Programme to extend the service life of an ageing aircraft beyond original design', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },
  { title: 'Technical Airworthiness Authority', nickname: 'TAA', subtitle: 'Authority responsible for technical airworthiness of a military aircraft type', category: 'Terminology', subcategory: 'Maintenance & Support', section: 'TERMINOLOGY', subsection: 'Maintenance & Support' },

  // ── TREATIES — Founding & Core Alliances ──────────────────────────────────
  { title: 'Washington Treaty / North Atlantic Treaty', nickname: '', subtitle: '1949 — NATO founding treaty including Article 5 collective defence', category: 'Treaties', subcategory: 'Founding & Core Alliances', section: 'TREATIES', subsection: 'Founding & Core Alliances' },
  { title: 'Article 5', nickname: '', subtitle: 'NATO collective defence clause — attack on one is attack on all', category: 'Treaties', subcategory: 'Founding & Core Alliances', section: 'TREATIES', subsection: 'Founding & Core Alliances' },
  { title: 'UKUSA Agreement', nickname: '', subtitle: '1946 — Five Eyes SIGINT-sharing treaty between UK, US, Canada, Australia, NZ', category: 'Treaties', subcategory: 'Founding & Core Alliances', section: 'TREATIES', subsection: 'Founding & Core Alliances' },
  { title: 'Five Power Defence Arrangements', nickname: 'FPDA', subtitle: '1971 — UK, Australia, NZ, Malaysia, Singapore mutual defence framework', category: 'Treaties', subcategory: 'Founding & Core Alliances', section: 'TREATIES', subsection: 'Founding & Core Alliances' },

  // ── TREATIES — Bilateral Defence Agreements ───────────────────────────────
  { title: 'Lancaster House Treaties', nickname: '', subtitle: '2010 — UK-France bilateral defence and nuclear cooperation treaties', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },
  { title: 'UK-US Defence Cooperation', nickname: 'Special Relationship', subtitle: 'Longstanding UK-US bilateral defence and intelligence partnership', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },
  { title: 'AUKUS Agreement', nickname: '', subtitle: '2021 — UK, US, Australia trilateral security partnership', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },
  { title: 'UK-Japan Reciprocal Access Agreement', nickname: '', subtitle: '2023 — bilateral agreement enabling UK and Japanese forces to operate from each other\'s territory', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },
  { title: 'GCAP Treaty', nickname: '', subtitle: 'UK, Italy, Japan treaty establishing the Global Combat Air Programme', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },
  { title: 'Joint Expeditionary Force framework', nickname: 'JEF', subtitle: 'UK-led multinational rapid deployment framework, 10 northern European nations', category: 'Treaties', subcategory: 'Bilateral Defence Agreements', section: 'TREATIES', subsection: 'Bilateral Defence Agreements' },

  // ── TREATIES — Arms Control & Non-Proliferation ───────────────────────────
  { title: 'Nuclear Non-Proliferation Treaty', nickname: 'NPT', subtitle: '1968 — treaty preventing spread of nuclear weapons', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'INF Treaty', nickname: '', subtitle: '1987 — eliminated intermediate-range nuclear missiles, US withdrew 2019', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'New START', nickname: '', subtitle: '2010 — strategic nuclear arms limitation treaty between US and Russia', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'Open Skies Treaty', nickname: '', subtitle: '1992 — mutual overflights for transparency, US withdrew 2020', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'Chemical Weapons Convention', nickname: 'CWC', subtitle: '1993 — prohibits development, production and use of chemical weapons', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'Ottawa Treaty', nickname: '', subtitle: '1997 — international treaty banning anti-personnel landmines', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'Wassenaar Arrangement', nickname: '', subtitle: 'Multilateral export controls on conventional arms and dual-use technologies', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },
  { title: 'Missile Technology Control Regime', nickname: 'MTCR', subtitle: 'Informal political arrangement controlling export of missile technology', category: 'Treaties', subcategory: 'Arms Control & Non-Proliferation', section: 'TREATIES', subsection: 'Arms Control & Non-Proliferation' },

  // ── TREATIES — Operational & Status Agreements ────────────────────────────
  { title: 'Status of Forces Agreement', nickname: 'SOFA', subtitle: 'Agreement defining legal status of foreign military personnel in host nations', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },
  { title: 'NATO SOFA', nickname: '', subtitle: '1951 — defines legal status of NATO forces in alliance member states', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },
  { title: 'UN Security Council Resolutions', nickname: 'UNSCR', subtitle: 'UNSCR 678, 1441 and 1973 provided legal authority for RAF operations', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },
  { title: 'Acquisition and Cross-Servicing Agreements', nickname: 'ACSA', subtitle: 'US-UK logistics and support sharing agreements', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },
  { title: 'Chicago Convention', nickname: '', subtitle: '1944 — foundation of international civil aviation law and ICAO', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },
  { title: 'NATO STANAG', nickname: '', subtitle: 'NATO Standardisation Agreements enabling interoperability between Allied forces', category: 'Treaties', subcategory: 'Operational & Status Agreements', section: 'TREATIES', subsection: 'Operational & Status Agreements' },

  // ── AOR — UK Home Air Defence ─────────────────────────────────────────────
  { title: 'UK Air Defence Region', nickname: 'UKADR', subtitle: 'Defined airspace in which the RAF has primary air defence responsibility', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'UK QRA North', nickname: '', subtitle: 'Quick Reaction Alert Typhoons at RAF Lossiemouth, primarily intercepting Russian aircraft', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'UK QRA South', nickname: '', subtitle: 'Quick Reaction Alert Typhoons at RAF Coningsby covering southern UK airspace', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'UK Air Surveillance and Control System', nickname: 'ASACS', subtitle: 'RAF Boulmer-based ground radar and control network for UK air defence', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'UKADGE', nickname: '', subtitle: 'UK Air Defence Ground Environment — integrated ground radar and control network', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'Fylingdales Ballistic Missile Early Warning', nickname: '', subtitle: 'RAF Fylingdales radar feeding into NATO Ballistic Missile Defence network', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },
  { title: 'Joint Air Defence Operations Centre', nickname: 'JADOC', subtitle: 'Combined operations centre coordinating UK air defence', category: 'AOR', subcategory: 'UK Home Air Defence', section: 'AOR', subsection: 'UK Home Air Defence' },

  // ── AOR — NATO AOR ────────────────────────────────────────────────────────
  { title: 'Allied Air Command', nickname: 'AIRCOM', subtitle: 'NATO air command headquartered at Ramstein, Germany', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'CAOC Uedem', nickname: '', subtitle: 'Combined Air Operations Centre managing northern European airspace', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'CAOC Torrejon', nickname: '', subtitle: 'Combined Air Operations Centre managing southern Europe and Mediterranean', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'Baltic Air Policing', nickname: 'BAP', subtitle: 'NATO standing air policing mission from Šiauliai and Ämari air bases', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'Eastern Flank', nickname: '', subtitle: 'NATO Enhanced Forward Presence in Poland and Baltic States', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'Northern Flank', nickname: '', subtitle: 'Norway, Iceland, Greenland, Faroes — GIUK Gap NATO strategic corridor', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },
  { title: 'Southern Flank', nickname: '', subtitle: 'Mediterranean, Turkey, Black Sea — NATO southern AOR', category: 'AOR', subcategory: 'NATO AOR', section: 'AOR', subsection: 'NATO AOR' },

  // ── AOR — Middle East & CENTCOM ───────────────────────────────────────────
  { title: 'Op SHADER AOR', nickname: '', subtitle: 'Iraq and Syria area of operations for CJTF-OIR counter-Daesh campaign', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Gulf / Arabian Gulf', nickname: '', subtitle: 'Op KIPION maritime area encompassing the Strait of Hormuz', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Yemen / Red Sea', nickname: '', subtitle: 'Houthi threat zone for shipping and air assets in the Red Sea', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Bahrain', nickname: '', subtitle: 'HQ NAVCENT and British Maritime Component Command base', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Qatar AOR', nickname: '', subtitle: 'Al Udeid Air Base — RAF forward element in the Gulf', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Iran', nickname: '', subtitle: 'Threat monitoring of IRGC drone and missile activity in the Gulf region', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },
  { title: 'Strait of Hormuz', nickname: '', subtitle: 'Critical maritime chokepoint where 20% of global oil transits', category: 'AOR', subcategory: 'Middle East & CENTCOM', section: 'AOR', subsection: 'Middle East & CENTCOM' },

  // ── AOR — Atlantic & GIUK Gap ─────────────────────────────────────────────
  { title: 'GIUK Gap', nickname: '', subtitle: 'Greenland-Iceland-UK — critical NATO maritime chokepoint for submarine transit', category: 'AOR', subcategory: 'Atlantic & GIUK Gap', section: 'AOR', subsection: 'Atlantic & GIUK Gap' },
  { title: 'Norwegian Sea AOR', nickname: '', subtitle: 'P-8A Poseidon maritime patrol area in the high north', category: 'AOR', subcategory: 'Atlantic & GIUK Gap', section: 'AOR', subsection: 'Atlantic & GIUK Gap' },
  { title: 'North Sea AOR', nickname: '', subtitle: 'UK and NATO area of responsibility in the North Sea', category: 'AOR', subcategory: 'Atlantic & GIUK Gap', section: 'AOR', subsection: 'Atlantic & GIUK Gap' },
  { title: 'Ascension Island AOR', nickname: '', subtitle: 'South Atlantic staging point for air bridge to the Falklands', category: 'AOR', subcategory: 'Atlantic & GIUK Gap', section: 'AOR', subsection: 'Atlantic & GIUK Gap' },

  // ── AOR — Africa ──────────────────────────────────────────────────────────
  { title: 'East Africa / Horn of Africa', nickname: '', subtitle: 'Kenya and Djibouti — counter-piracy and maritime security operations', category: 'AOR', subcategory: 'Africa', section: 'AOR', subsection: 'Africa' },
  { title: 'Sahel Region', nickname: '', subtitle: 'Growing instability zone with French-led operations and UK intelligence support', category: 'AOR', subcategory: 'Africa', section: 'AOR', subsection: 'Africa' },
  { title: 'Libya', nickname: '', subtitle: 'Post-Gaddafi monitoring and historic Op ELLAMY legacy AOR', category: 'AOR', subcategory: 'Africa', section: 'AOR', subsection: 'Africa' },
  { title: 'Sudan / South Sudan', nickname: '', subtitle: 'NEO contingency AOR — site of Op GOLDEN ORB evacuation 2023', category: 'AOR', subcategory: 'Africa', section: 'AOR', subsection: 'Africa' },

  // ── AOR — Indo-Pacific ────────────────────────────────────────────────────
  { title: 'Indo-Pacific Tilt', nickname: '', subtitle: 'UK strategic reorientation towards the Indo-Pacific per 2021 Integrated Review', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },
  { title: 'Japan', nickname: 'JASDF', subtitle: 'GCAP partner — growing JASDF interoperability and bilateral exercises', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },
  { title: 'South Korea', nickname: 'ROKAF', subtitle: 'ROKAF bilateral exercises and growing defence relationship', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },
  { title: 'RAAF Indo-Pacific Operations', nickname: 'RAAF', subtitle: 'Australian Air Force bilateral exercises and AUKUS operations in the Indo-Pacific', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },
  { title: 'Diego Garcia / BIOT', nickname: '', subtitle: 'Indian Ocean joint UK/US base used for ISR staging and long-range strike', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },
  { title: 'Singapore', nickname: '', subtitle: 'Five Power Defence Arrangements partner in Southeast Asia', category: 'AOR', subcategory: 'Indo-Pacific', section: 'AOR', subsection: 'Indo-Pacific' },

  // ── AOR — South Atlantic & Falklands ─────────────────────────────────────
  { title: 'Falkland Islands Patrol Zone', nickname: 'FIPZ', subtitle: '150nm exclusion zone around the Falkland Islands', category: 'AOR', subcategory: 'South Atlantic & Falklands', section: 'AOR', subsection: 'South Atlantic & Falklands' },
  { title: 'Falklands Air Operations', nickname: 'MPA', subtitle: 'Typhoon QRA, P-8A maritime patrol and garrison operations from RAF Mount Pleasant', category: 'AOR', subcategory: 'South Atlantic & Falklands', section: 'AOR', subsection: 'South Atlantic & Falklands' },
  { title: 'No. 78 Squadron Falklands', nickname: '', subtitle: 'Falklands SAR and transport helicopter operations', category: 'AOR', subcategory: 'South Atlantic & Falklands', section: 'AOR', subsection: 'South Atlantic & Falklands' },
  { title: 'South Atlantic Maritime Patrol', nickname: '', subtitle: 'P-8A Poseidon rotations from RAF Mount Pleasant for South Atlantic patrol', category: 'AOR', subcategory: 'South Atlantic & Falklands', section: 'AOR', subsection: 'South Atlantic & Falklands' }
];

// ─────────────────────────────────────────────────────────────────────────────
// seedLeads — drops all leads and briefs, re-inserts from LEADS array,
//             then creates one stub IntelligenceBrief per lead.
// Called on server startup (first run) and via POST /api/admin/leads/reset.
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function seedLeads() {
  try {
    // 1 — wipe leads + drop any stale indexes from old schema (e.g. text_1)
    await IntelLead.deleteMany({});
    try {
      await IntelLead.collection.dropIndex('text_1');
    } catch (_) { /* index may not exist — safe to ignore */ }

    // 2 — wipe all briefs and dependent data
    await Promise.all([
      IntelligenceBrief.deleteMany({}),
      IntelligenceBriefRead.deleteMany({}),
      GameQuizQuestion.deleteMany({}),
      GameSessionQuizAttempt.deleteMany({}),
      GameSessionQuizResult.deleteMany({}),
      GameOrderOfBattle.deleteMany({}),
      GameSessionOrderOfBattleResult.deleteMany({}),
      GameFlashcardRecall.deleteMany({}),
      GameSessionFlashcardRecallResult.deleteMany({}),
      GameWhosAtAircraft.deleteMany({}),
      GameSessionWhosAtAircraftResult.deleteMany({}),
      AircoinLog.deleteMany({}),
    ]);

    // 3 — insert leads
    await IntelLead.insertMany(LEADS.map(l => ({
      title:       l.title,
      nickname:    l.nickname   || '',
      subtitle:    l.subtitle   || '',
      category:    l.category,
      subcategory: l.subcategory || '',
      section:     l.section    || '',
      subsection:  l.subsection || '',
      isPublished: false,
    })));

    // 4 — create one stub brief per lead
    const stubs = LEADS.map(l => ({
      title:               l.title,
      subtitle:            l.subtitle   || '',
      category:            l.category,
      subcategory:         l.subcategory || '',
      status:              'stub',
      descriptionSections: [],
      keywords:            [],
      sources:             [],
    }));
    await IntelligenceBrief.insertMany(stubs);

    console.log(`seedLeads: ${LEADS.length} leads inserted, ${stubs.length} stub briefs created`);
  } catch (err) {
    console.error('seedLeads error:', err.message);
  }
};

module.exports.LEADS = LEADS;
