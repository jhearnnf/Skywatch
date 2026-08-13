// CBAT "Verbal Logic Test" (VLT) scenario packs.
//
// From the guide corpus: "a table of eight tabs of information, three minutes to
// read them, then the questions start"; "no subject knowledge is required —
// whatever the topic turns out to be, everything you need is in the tabs"; and
// the method that matters — "the answers aren't written plainly in the text, you
// have to join the dots between separate sections. Don't keyword-hunt for a
// phrase from the question. If you find your answer sitting there in one
// sentence, check it — that's usually the distractor rather than the answer."
//
// Which is why these are WRITTEN rather than generated. Numeric facts across
// tabs can be rolled convincingly (see sltGenerator.js, which does exactly
// that); prose whose answer lives in the gap between two paragraphs cannot. Each
// question here names the tabs it joins, and carries a `trap` — an option that
// IS stated plainly somewhere in the text and is wrong. That is the whole test.
//
// Topics are deliberately mundane and non-military. The real thing has been
// described as being about rocks or renewable energy; the point is that the
// subject is irrelevant and looking intimidating is part of the exercise.
//
// Pack shape:
//   { id, title, tabs: [{ id, title, text }], easierTabs: [id], questions: [...] }
//   questions: { id, prompt, answer, distractors: [...], needs: [tabId, tabId], trap }
//     `needs`  — the tabs that must both be read; used to filter a pack down to
//                the Easier tab subset, and pinned by a test so no question can
//                reference a tab its difficulty never shows.
//     `trap`   — which of the distractors is the plainly-stated one. Recorded so
//                the post-game review can point at it; the player never sees the
//                label during play.

export const VLT_PACKS = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tidal',
    title: 'Meridian Tidal Energy Programme',
    easierTabs: ['overview', 'turbines', 'sites', 'maintenance', 'grid'],
    tabs: [
      {
        id: 'overview',
        title: 'Programme Overview',
        text: 'The Meridian Tidal Energy Programme operates generating stations in three estuaries: Calder, Fenwick and Strathorn. Each estuary was developed as a separate stage, and the three run under a single operating licence held by Meridian Marine Power. The programme was originally scoped for four estuaries. A fourth station is no longer part of the programme.',
      },
      {
        id: 'turbines',
        title: 'Turbine Types',
        text: 'Three turbine types are approved for use. The Type A generates 600 kW and requires a tidal range of at least 3 metres. The Type B generates 900 kW and requires a range of at least 4.5 metres. The Type C is the most powerful at 1,400 kW, but requires a range of at least 6 metres and cannot be installed in water shallower than 20 metres.',
      },
      {
        id: 'sites',
        title: 'Site Conditions',
        text: 'Calder has a mean tidal range of 5.2 metres and a working depth of 14 metres. Fenwick has a mean tidal range of 6.8 metres and a working depth of 26 metres. Strathorn has a mean tidal range of 3.4 metres and a working depth of 9 metres. Depths are quoted at mean low water and do not vary materially across each site.',
      },
      {
        id: 'maintenance',
        title: 'Maintenance',
        text: 'Type A units are serviced every 18 months, Type B every 12 months and Type C every 9 months. All servicing requires the programme jack-up vessel, of which there is one. The vessel cannot operate in water shallower than 12 metres; anything below that depth is serviced by divers on a separate schedule agreed case by case.',
      },
      {
        id: 'grid',
        title: 'Grid Connection',
        text: 'Calder exports to the northern grid, which accepts up to 8 MW from the programme. Fenwick exports to the eastern grid, which accepts up to 20 MW. Strathorn has no export connection and charges a shoreside battery installation instead. Export limits are firm and are not raised for short periods of high generation.',
      },
      {
        id: 'staffing',
        title: 'Staffing',
        text: 'Each station is staffed at four technicians for every six turbines or part thereof. Technicians certify on a single turbine type and may not work unsupervised on any other. Certification is renewed annually and lapses immediately if a technician spends more than six months away from that type.',
      },
      {
        id: 'environment',
        title: 'Environmental Constraints',
        text: 'Type C units may not be installed anywhere designated as seal habitat. Fenwick carries that designation between October and March each year. Outside those months no habitat restriction applies at any of the three sites. Noise monitoring runs year-round regardless of designation.',
      },
      {
        id: 'history',
        title: 'Programme History',
        text: 'Calder was commissioned in 2019, Fenwick in 2022 and Strathorn in 2024. A fourth station at Brackmoor reached consent but was cancelled before construction on cost grounds. Brackmoor would have had a tidal range of 7.1 metres, the largest of the four.',
      },
    ],
    questions: [
      {
        id: 'tidal-largest-at-calder',
        // sites: Calder range 5.2 m, depth 14 m → turbines: C needs 6 m (fails),
        // B needs 4.5 m (passes). Largest that qualifies is B.
        needs: ['sites', 'turbines'],
        prompt: 'What is the most powerful turbine type that could be installed at Calder?',
        answer: 'Type B',
        distractors: ['Type C', 'Type A', 'None of the three'],
        trap: 'Type C',
      },
      {
        id: 'tidal-vessel-cannot-reach',
        // sites: Strathorn depth 9 m → maintenance: vessel needs 12 m.
        needs: ['sites', 'maintenance'],
        prompt: 'At which station can the jack-up vessel not operate?',
        answer: 'Strathorn',
        distractors: ['Calder', 'Fenwick', 'It can operate at all three'],
        trap: 'It can operate at all three',
      },
      {
        id: 'tidal-only-c-site',
        // turbines: C needs range ≥6 m AND depth ≥20 m → sites: only Fenwick
        // (6.8 m / 26 m) satisfies both.
        needs: ['turbines', 'sites'],
        prompt: 'Which station is the only one whose conditions permit a Type C turbine?',
        answer: 'Fenwick',
        distractors: ['Calder', 'Strathorn', 'Calder and Fenwick'],
        trap: 'Calder and Fenwick',
      },
      {
        id: 'tidal-calder-vs-fenwick-output',
        // sites+turbines: Calder tops out at Type B (900 kW), Fenwick at Type C
        // (1,400 kW). Difference is 500 kW.
        needs: ['sites', 'turbines'],
        prompt: 'Each station installs the most powerful turbine it can take. How much more does one Fenwick unit generate than one Calder unit?',
        answer: '500 kW',
        distractors: ['800 kW', '1,400 kW', 'They generate the same'],
        trap: '1,400 kW',
      },
      {
        id: 'tidal-service-interval-calder',
        // sites+turbines: Calder tops out at Type B → maintenance: Type B is
        // serviced every 12 months.
        needs: ['maintenance', 'sites'],
        prompt: 'Calder installs the most powerful turbine its conditions allow. How often is it serviced?',
        answer: 'Every 12 months',
        distractors: ['Every 9 months', 'Every 18 months', 'Every 6 months'],
        trap: 'Every 9 months',
      },
      {
        id: 'tidal-no-export',
        // grid: Strathorn has no export connection → overview: three stations
        // hold one licence, so "all three export" is wrong.
        needs: ['grid', 'overview'],
        prompt: 'How many of the programme’s stations export to a grid?',
        answer: 'Two',
        distractors: ['Three', 'One', 'Four'],
        trap: 'Three',
      },
      {
        id: 'tidal-northern-limit',
        // grid: northern grid accepts 8 MW → turbines: Type B is 900 kW, so
        // 8 MW / 0.9 MW = 8.88 → 8 units before the firm limit is exceeded.
        needs: ['grid', 'turbines'],
        prompt: 'How many Type B turbines could Calder run at full output without exceeding its export limit?',
        answer: 'Eight',
        distractors: ['Nine', 'Twenty', 'Thirteen'],
        trap: 'Nine',
      },
      {
        id: 'tidal-most-frequent-service',
        // sites+turbines: only Fenwick can take Type C → maintenance: Type C is
        // serviced every 9 months, the shortest interval.
        needs: ['maintenance', 'sites'],
        prompt: 'If every station installs the most powerful turbine its conditions allow, which will be serviced most often?',
        answer: 'Fenwick',
        distractors: ['Calder', 'Strathorn', 'All three equally'],
        trap: 'All three equally',
      },
      {
        id: 'tidal-strathorn-type',
        // sites: Strathorn range 3.4 m → turbines: only Type A (≥3 m) qualifies.
        needs: ['sites', 'turbines'],
        prompt: 'Which turbine types could be installed at Strathorn?',
        answer: 'Type A only',
        distractors: ['Types A and B', 'Type C only', 'All three types'],
        trap: 'All three types',
      },
      {
        id: 'tidal-technicians',
        // staffing: 4 technicians per 6 turbines or part thereof → 14 turbines
        // is three blocks (6, 6, 2) → 12 technicians.
        needs: ['staffing', 'overview'],
        prompt: 'A station running fourteen turbines is staffed to the stated ratio. How many technicians does it need?',
        answer: 'Twelve',
        distractors: ['Ten', 'Eight', 'Fourteen'],
        trap: 'Eight',
      },
      {
        id: 'tidal-oldest',
        // history: Calder 2019 → grid: Calder exports to the northern grid.
        needs: ['history', 'grid'],
        prompt: 'Which grid does the programme’s oldest station export to?',
        answer: 'The northern grid',
        distractors: ['The eastern grid', 'It does not export', 'Both northern and eastern'],
        trap: 'The eastern grid',
      },
      {
        id: 'tidal-battery-range',
        // grid: Strathorn is the battery site → sites: Strathorn range 3.4 m.
        needs: ['grid', 'sites'],
        prompt: 'What is the tidal range at the station that charges a shoreside battery?',
        answer: '3.4 metres',
        distractors: ['6.8 metres', '5.2 metres', '7.1 metres'],
        trap: '7.1 metres',
      },
      // ── Hard-only: these join a tab the Easier subset never shows ──────────
      {
        id: 'tidal-fenwick-winter',
        // environment: Fenwick is seal habitat Oct–Mar and Type C is barred
        // there → sites/turbines: Fenwick is the only Type C site at all.
        needs: ['environment', 'sites'],
        prompt: 'In which months may the only Type C–capable station not actually take one?',
        answer: 'October to March',
        distractors: ['April to September', 'All year', 'Never, the restriction does not apply there'],
        trap: 'Never, the restriction does not apply there',
      },
      {
        id: 'tidal-cancelled-range',
        // history: Brackmoor 7.1 m, cancelled → turbines: that clears Type C's
        // 6 m range requirement, so it would have qualified.
        needs: ['history', 'turbines'],
        prompt: 'Would the cancelled fourth station have met the tidal range requirement for a Type C turbine?',
        answer: 'Yes, its range exceeded the requirement',
        distractors: ['No, its range was too small', 'No, Type C was not approved then', 'The range was never surveyed'],
        trap: 'No, Type C was not approved then',
      },
      {
        id: 'tidal-certification-lapse',
        // staffing: certification lapses after six months away from the type →
        // environment/maintenance: a Type C site barred Oct–Mar is exactly six
        // months, so certification is at the edge rather than over it.
        needs: ['staffing', 'environment'],
        prompt: 'A technician certified on Type C works only at Fenwick and does no Type C work during the habitat designation. How long is that break?',
        answer: 'Six months, the certification is at its limit but has not lapsed',
        distractors: ['Three months', 'Twelve months, so it has lapsed', 'There is no break'],
        trap: 'There is no break',
      },
      {
        id: 'tidal-eastern-capacity',
        // grid: eastern grid 20 MW → turbines: Type C is 1,400 kW → 20 / 1.4 =
        // 14.28 → 14 units.
        needs: ['grid', 'turbines'],
        prompt: 'How many Type C turbines could Fenwick run at full output within its export limit?',
        answer: 'Fourteen',
        distractors: ['Fifteen', 'Twenty', 'Twenty-two'],
        trap: 'Twenty',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'survey',
    title: 'Northern Basin Geological Survey',
    easierTabs: ['remit', 'samples', 'teams', 'transport', 'seasons'],
    tabs: [
      {
        id: 'remit',
        title: 'Survey Remit',
        text: 'The Northern Basin Survey catalogues rock samples from four zones: Ashfell, Braid, Cullen and Dunmore. Every sample recovered must be logged, boxed and returned to the central store before it can be analysed. Zones are surveyed one at a time and never concurrently.',
      },
      {
        id: 'samples',
        title: 'Sample Classes',
        text: 'Samples fall into three classes. Class 1 is loose surface material and needs no special handling. Class 2 is drilled core, which must be sealed within two hours of recovery. Class 3 is friable material, which must be sealed within two hours and additionally kept below 10 °C for the whole journey.',
      },
      {
        id: 'teams',
        title: 'Field Teams',
        text: 'Two field teams are available. The Red team is equipped for drilling and is the only team able to recover core. The Blue team carries no drilling rig but is the only team with a refrigerated container. Neither team is equipped to operate at night.',
      },
      {
        id: 'transport',
        title: 'Transport',
        text: 'Samples travel from the zones to the central store by road. The journey from Ashfell takes 90 minutes, from Braid 3 hours, from Cullen 40 minutes and from Dunmore 5 hours. There is no alternative route from any zone and no facility to seal or chill samples in transit.',
      },
      {
        id: 'seasons',
        title: 'Access Seasons',
        text: 'Ashfell and Cullen are accessible all year. Braid is accessible between May and September only. Dunmore is accessible between June and August only, and its access track is closed entirely in any week when rainfall exceeds 40 mm.',
      },
      {
        id: 'analysis',
        title: 'Analysis',
        text: 'The central store analyses Class 1 samples on arrival, Class 2 within a week and Class 3 within 24 hours. Analysis capacity is forty samples a week across all classes combined. Samples that miss their handling requirement are logged but not analysed.',
      },
      {
        id: 'equipment',
        title: 'Equipment',
        text: 'The drilling rig is shared with a separate programme and is available to the survey for eight weeks each year. The refrigerated container is owned outright by the survey and has no availability limit. Both items require a qualified operator, and the survey employs two.',
      },
      {
        id: 'reporting',
        title: 'Reporting',
        text: 'A zone report is issued once every sample from that zone has been analysed. Zone reports are numbered in the order the zones were surveyed, not in the order the reports are issued. The survey has issued three zone reports to date.',
      },
    ],
    questions: [
      {
        id: 'survey-core-team',
        // samples: Class 2 is core → teams: only Red can recover core.
        needs: ['samples', 'teams'],
        prompt: 'Which team can recover Class 2 samples?',
        answer: 'Red only',
        distractors: ['Blue only', 'Either team', 'Neither team'],
        trap: 'Either team',
      },
      {
        id: 'survey-class3-zone',
        // samples: Class 3 must be sealed within 2 hrs and chilled → transport:
        // Braid is 3 hrs and Dunmore 5 hrs, so both blow the seal window; only
        // Ashfell (90 min) and Cullen (40 min) are inside it. Question asks
        // which listed zone is NOT viable.
        needs: ['samples', 'transport'],
        prompt: 'From which zones is a Class 3 sample impossible to deliver within its handling requirement?',
        answer: 'Braid and Dunmore',
        distractors: ['Dunmore only', 'Ashfell and Cullen', 'None, all four are within the window'],
        trap: 'None, all four are within the window',
      },
      {
        id: 'survey-chilled-team',
        // samples: Class 3 needs chilling → teams: only Blue has the refrigerated
        // container, and Blue cannot drill.
        needs: ['teams', 'samples'],
        prompt: 'Which team must recover Class 3 samples?',
        answer: 'Blue, because it holds the only refrigerated container',
        distractors: ['Red, because it is the better equipped team', 'Either team', 'Both teams together'],
        trap: 'Either team',
      },
      {
        id: 'survey-longest-journey',
        // transport: Dunmore 5 hrs → seasons: Dunmore is June–August only.
        needs: ['transport', 'seasons'],
        prompt: 'In which months is the zone with the longest journey to the store accessible?',
        answer: 'June to August',
        distractors: ['May to September', 'All year', 'It is never accessible'],
        trap: 'May to September',
      },
      {
        id: 'survey-year-round-core',
        // seasons: Ashfell and Cullen all year → teams/samples: core needs Red,
        // no seasonal bar. So two zones.
        needs: ['seasons', 'remit'],
        prompt: 'How many zones can be surveyed at any time of year?',
        answer: 'Two',
        distractors: ['Four', 'Three', 'One'],
        trap: 'Four',
      },
      {
        id: 'survey-concurrent',
        // remit: zones are surveyed one at a time → teams: two teams exist, so
        // "both teams in different zones" is barred by the remit, not by staffing.
        needs: ['remit', 'teams'],
        prompt: 'Both teams are available. Can the survey work two zones on the same day?',
        answer: 'No, zones are never surveyed concurrently',
        distractors: ['Yes, one team per zone', 'Yes, but only in the all-year zones', 'Only with a second drilling rig'],
        trap: 'Yes, one team per zone',
      },
      {
        id: 'survey-class1-transport',
        // samples: Class 1 needs no special handling → transport: so even the
        // 5-hour Dunmore run is fine.
        needs: ['samples', 'transport'],
        prompt: 'Is the five-hour journey a problem for a Class 1 sample?',
        answer: 'No, Class 1 has no handling deadline',
        distractors: ['Yes, it exceeds the two-hour limit', 'Yes, unless it is chilled', 'Only in summer'],
        trap: 'Yes, it exceeds the two-hour limit',
      },
      {
        id: 'survey-cullen-window',
        // transport: Cullen 40 min → samples: comfortably inside the 2-hour seal
        // window, so Cullen supports every class.
        needs: ['transport', 'samples'],
        prompt: 'Which sample classes can be recovered from Cullen and still meet their handling requirement?',
        answer: 'All three classes',
        distractors: ['Class 1 only', 'Classes 1 and 2 only', 'Class 3 only'],
        trap: 'Class 1 only',
      },
      {
        id: 'survey-braid-class2',
        // transport: Braid 3 hrs → samples: Class 2 must be sealed within 2 hrs,
        // and transport says there is no facility to seal in transit.
        needs: ['transport', 'samples'],
        prompt: 'Can Class 2 samples be recovered from Braid?',
        answer: 'No, the journey exceeds the two-hour sealing window',
        distractors: ['Yes, core is sealed at the store', 'Yes, if the Red team recovers them', 'Only between May and September'],
        trap: 'Only between May and September',
      },
      {
        id: 'survey-night',
        // teams: neither team works at night → seasons: so a summer-only zone
        // still cannot be extended by working nights.
        needs: ['teams', 'seasons'],
        prompt: 'Dunmore’s three-month window is tight. Can the survey extend its working day into the night there?',
        answer: 'No, neither team is equipped for night work',
        distractors: ['Yes, the Red team is equipped for it', 'Yes, with the refrigerated container', 'Only in June'],
        trap: 'Yes, the Red team is equipped for it',
      },
      // ── Hard-only ─────────────────────────────────────────────────────────
      {
        id: 'survey-rig-weeks',
        // equipment: rig available 8 weeks/year → seasons: Braid is May–Sept
        // (about 22 weeks), so the rig, not the season, is the binding limit.
        needs: ['equipment', 'seasons'],
        prompt: 'What limits how much core the survey can recover from Braid in a year?',
        answer: 'The drilling rig’s eight-week availability',
        distractors: ['Braid’s five-month access season', 'The number of qualified operators', 'The refrigerated container'],
        trap: 'Braid’s five-month access season',
      },
      {
        id: 'survey-capacity',
        // analysis: 40 samples a week across all classes → remit: one zone at a
        // time, so the cap is not per zone.
        needs: ['analysis', 'remit'],
        prompt: 'Two zones each send thirty samples in the same week. What happens?',
        answer: 'That cannot occur, only one zone is surveyed at a time',
        distractors: ['All sixty are analysed', 'Forty are analysed and twenty wait', 'The Class 3 samples are prioritised'],
        trap: 'Forty are analysed and twenty wait',
      },
      {
        id: 'survey-report-order',
        // reporting: reports are numbered by survey order, not issue order →
        // remit: four zones, three reports issued, so one zone is outstanding.
        needs: ['reporting', 'remit'],
        prompt: 'Three zone reports have been issued. What can be said about the numbering?',
        answer: 'One zone is still outstanding, and report numbers follow survey order rather than issue order',
        distractors: ['The three issued reports are numbered 1, 2 and 3', 'All four zones are complete', 'Reports are numbered as they are issued'],
        trap: 'Reports are numbered as they are issued',
      },
      {
        id: 'survey-class3-analysis',
        // analysis: Class 3 within 24 hrs → samples: Class 3 also needs chilling
        // throughout, so both clocks run from recovery, not from arrival.
        needs: ['analysis', 'samples'],
        prompt: 'A Class 3 sample arrives at the store. What are the two requirements it has already had to meet?',
        answer: 'Sealed within two hours and kept below 10 °C for the whole journey',
        distractors: ['Sealed within two hours only', 'Analysed within 24 hours and logged', 'Kept below 10 °C only'],
        trap: 'Analysed within 24 hours and logged',
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'depot',
    title: 'Halstow Distribution Depot',
    easierTabs: ['operation', 'bays', 'vehicles', 'shifts', 'loads'],
    tabs: [
      {
        id: 'operation',
        title: 'Depot Operation',
        text: 'Halstow depot receives goods by road and dispatches them to five regional centres. The depot runs every day except Sunday. Nothing may be dispatched on the same day it arrives; every consignment is held overnight for checking before it leaves.',
      },
      {
        id: 'bays',
        title: 'Loading Bays',
        text: 'The depot has six loading bays. Bays 1 to 4 take vehicles of any size. Bays 5 and 6 have a low canopy and cannot take a vehicle over 3.5 metres tall. All six bays are in use whenever the depot is open.',
      },
      {
        id: 'vehicles',
        title: 'Vehicle Fleet',
        text: 'The fleet is three types. The Rigid is 3.1 metres tall and carries 8 pallets. The Curtainsider is 4.0 metres tall and carries 26 pallets. The Double-deck is 4.7 metres tall and carries 46 pallets. Vehicle heights are fixed and cannot be reduced for loading.',
      },
      {
        id: 'shifts',
        title: 'Shifts',
        text: 'Two shifts cover the working day: an early shift from 05:00 to 13:00 and a late shift from 13:00 to 21:00. Loading may only take place while a shift is running. There is no night shift and no cover between 21:00 and 05:00.',
      },
      {
        id: 'loads',
        title: 'Consignments',
        text: 'A consignment is never split across two vehicles. Consignments arrive in sizes of 8, 26 or 46 pallets, matching the fleet capacities exactly. A consignment that arrives on a day the depot closes the following day is held until the next working day.',
      },
      {
        id: 'centres',
        title: 'Regional Centres',
        text: 'The five regional centres are Ardley, Bexton, Crowmarsh, Denhall and Eastcote. Ardley and Bexton have low approach bridges and accept vehicles no taller than 4.2 metres. The remaining three accept any vehicle in the fleet.',
      },
      {
        id: 'staffing',
        title: 'Depot Staffing',
        text: 'Each loading bay in use requires one loader. Loaders are assigned to a bay for a whole shift and do not move between bays. The depot employs fourteen loaders in total across both shifts.',
      },
      {
        id: 'checks',
        title: 'Overnight Checks',
        text: 'Overnight checking takes four hours per consignment and runs unattended. Checking begins when the late shift ends. A consignment whose check has not finished by the start of the early shift is not dispatched that day.',
      },
    ],
    questions: [
      {
        id: 'depot-bay-fit',
        // bays: 5 and 6 cap at 3.5 m → vehicles: only the Rigid (3.1 m) fits.
        needs: ['bays', 'vehicles'],
        prompt: 'Which vehicle type can use bays 5 and 6?',
        answer: 'The Rigid only',
        distractors: ['The Rigid and the Curtainsider', 'All three types', 'The Double-deck only'],
        trap: 'All three types',
      },
      {
        id: 'depot-largest-consignment-bay',
        // loads: 46 pallets → vehicles: only the Double-deck (4.7 m) → bays: it
        // needs bays 1–4.
        needs: ['loads', 'vehicles'],
        prompt: 'A 46-pallet consignment arrives. Which vehicle must carry it?',
        answer: 'The Double-deck, because consignments are never split',
        distractors: ['Two Curtainsiders', 'Any vehicle, split across loads', 'The Curtainsider'],
        trap: 'Two Curtainsiders',
      },
      {
        id: 'depot-shift-gap',
        // shifts: no cover 21:00–05:00 → operation: so nothing loads overnight
        // even though the depot holds consignments overnight.
        needs: ['shifts', 'operation'],
        prompt: 'Consignments are held overnight. Can they be loaded during that time?',
        answer: 'No, no shift runs between 21:00 and 05:00',
        distractors: ['Yes, that is what the overnight hold is for', 'Yes, on the late shift', 'Only on Saturdays'],
        trap: 'Yes, that is what the overnight hold is for',
      },
      {
        id: 'depot-saturday-arrival',
        // operation: closed Sunday, nothing dispatched the day it arrives →
        // loads: a Saturday arrival is held to the next working day, Monday.
        needs: ['operation', 'loads'],
        prompt: 'A consignment arrives on Saturday. When is the earliest it can be dispatched?',
        answer: 'Monday',
        distractors: ['Sunday', 'Saturday evening', 'Tuesday'],
        trap: 'Sunday',
      },
      {
        id: 'depot-any-bay',
        // bays: 1–4 take any size → vehicles: three types, so the Double-deck is
        // restricted to four of the six bays.
        needs: ['bays', 'vehicles'],
        prompt: 'How many of the six bays can load a Double-deck?',
        answer: 'Four',
        distractors: ['Six', 'Two', 'None'],
        trap: 'Six',
      },
      {
        id: 'depot-loaders-per-shift',
        // staffing (easier subset uses shifts instead): six bays in use, one
        // loader each, two shifts → twelve of the fourteen are on bays.
        needs: ['shifts', 'bays'],
        prompt: 'All six bays run on both shifts. How many bay-shifts is that in a day?',
        answer: 'Twelve',
        distractors: ['Six', 'Fourteen', 'Eight'],
        trap: 'Six',
      },
      {
        id: 'depot-eight-pallets',
        // loads: 8-pallet consignment → vehicles: Rigid carries 8, and it is the
        // only vehicle that also fits the low bays.
        needs: ['loads', 'vehicles'],
        prompt: 'An 8-pallet consignment arrives. Which vehicle matches it exactly?',
        answer: 'The Rigid',
        distractors: ['The Curtainsider', 'The Double-deck', 'Any of the three'],
        trap: 'Any of the three',
      },
      {
        id: 'depot-open-days',
        // operation: every day except Sunday → shifts: two shifts a day, so
        // twelve shifts a week.
        needs: ['operation', 'shifts'],
        prompt: 'How many shifts does the depot run in a full week?',
        answer: 'Twelve',
        distractors: ['Fourteen', 'Six', 'Ten'],
        trap: 'Fourteen',
      },
      {
        id: 'depot-curtainsider-bays',
        // vehicles: Curtainsider 4.0 m → bays: over the 3.5 m canopy, so bays
        // 1–4 only.
        needs: ['vehicles', 'bays'],
        prompt: 'Which bays can load a Curtainsider?',
        answer: 'Bays 1 to 4',
        distractors: ['All six bays', 'Bays 5 and 6', 'Bays 1 to 4 and bay 5'],
        trap: 'All six bays',
      },
      {
        id: 'depot-no-same-day',
        // operation: nothing dispatched the day it arrives → shifts: so an
        // early-shift arrival cannot go out on the late shift the same day.
        needs: ['operation', 'shifts'],
        prompt: 'A consignment arrives at 06:00. Can it go out on the late shift that day?',
        answer: 'No, nothing is dispatched on the day it arrives',
        distractors: ['Yes, the late shift covers it', 'Yes, if a bay is free', 'Only if it is an 8-pallet load'],
        trap: 'Yes, the late shift covers it',
      },
      // ── Hard-only ─────────────────────────────────────────────────────────
      {
        id: 'depot-ardley-vehicle',
        // centres: Ardley caps at 4.2 m → vehicles: Rigid 3.1 and Curtainsider
        // 4.0 pass, Double-deck 4.7 does not.
        needs: ['centres', 'vehicles'],
        prompt: 'Which vehicles can deliver to Ardley?',
        answer: 'The Rigid and the Curtainsider',
        distractors: ['All three', 'The Rigid only', 'The Double-deck only'],
        trap: 'All three',
      },
      {
        id: 'depot-bexton-46',
        // loads: 46 pallets means a Double-deck and no splitting → centres:
        // Bexton caps at 4.2 m, so it cannot be delivered as one consignment.
        needs: ['loads', 'centres'],
        prompt: 'A 46-pallet consignment is destined for Bexton. What is the problem?',
        answer: 'Only the Double-deck carries 46 pallets, and Bexton cannot accept it',
        distractors: ['Nothing, it goes as two Curtainsiders', 'Bexton has no loading bay', 'It must wait for the early shift'],
        trap: 'Nothing, it goes as two Curtainsiders',
      },
      {
        id: 'depot-check-window',
        // checks: 4 hours per consignment, starting when the late shift ends
        // (21:00) → shifts: early shift starts 05:00, an eight-hour gap, so two
        // consignments finish in time.
        needs: ['checks', 'shifts'],
        prompt: 'Checking runs one consignment at a time from the end of the late shift. How many can be cleared before the early shift begins?',
        answer: 'Two',
        distractors: ['One', 'Four', 'Six'],
        trap: 'One',
      },
      {
        id: 'depot-loaders-total',
        // staffing: 14 loaders, one per bay in use, bays assigned for a whole
        // shift → bays: six bays over two shifts needs twelve, leaving two spare.
        needs: ['staffing', 'bays'],
        prompt: 'With all six bays running on both shifts, how many of the fourteen loaders are not on a bay?',
        answer: 'Two',
        distractors: ['None', 'Eight', 'Six'],
        trap: 'None',
      },
    ],
  },
]

export const VLT_PACK_BY_ID = Object.fromEntries(VLT_PACKS.map(p => [p.id, p]))
