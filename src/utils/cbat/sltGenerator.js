// CBAT "System Logic Test" (SLT) generator.
//
// From the guide corpus: "You get tabs describing a system, mixing figures and
// text — things like how much oil something burns or how much power it puts out.
// Then questions that make you find and use the right figure. It's a search and
// apply task, not a memory task. Nobody expects you to have learned the content."
//
// So the tabs stay open while you answer. What is being measured is how fast you
// can locate the right figure and do something with it, which is why the corpus's
// one piece of strategy — "use the reading time twice, once for the content and
// then a quick second skim just to fix which tab holds which kind of information"
// — is worth anything at all. The game is built so that advice pays: the reading
// window is real, and the questions are ordered so no two consecutive ones live
// on the same tab.
//
// TWO THINGS THE GUIDE STATES THAT THIS DID NOT DO, both fixed here:
//
//   1. "A numbered index of 15 tabs." The catalogue held eight and a run drew
//      four or six of them. Fifteen is a materially different search, and the
//      search is the test.
//   2. "No single tab answers a question." Every question is now a two-tab join
//      on BOTH difficulties. Easier was single-hop, which is a different task —
//      look one figure up, do a sum — and had the player practising it as though
//      it were this one. Easier is now easier by showing fewer tabs and giving a
//      longer clock, not by changing the shape of the question.
//
// Making every question a join across a fifteen-tab index needs more joins than
// are worth hand-writing, so there are two sources. The hand-written joins below
// come first, because they carry the interesting arithmetic. GENERIC joins fill
// in behind them: any two fields on different tabs sharing a unit can be
// subtracted or divided, which guarantees a join exists for whatever the draw
// happens to be. A tab therefore needs no templates of its own to be usable —
// it only has to share a unit with something else, which `sltGenerator.test.js`
// pins for every tab in the catalogue.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a
// system in tests. Defaults to Math.random for live play.
//
// generateSltSystem({ tabCount, questionCount }, rng)
//   → { name, tabs, questions }
//     tabs      = [{ id, title, blurb, fields: [{ key, label, value, unit }] }]
//     questions = [{ id, prompt, answer, options, hops, tabIds }]

// ── Tab catalogue ────────────────────────────────────────────────────────────
// Each spec generates one tab of a fictional airframe's systems. `fields` are
// the figures; `blurb` is the prose the real test mixes in with them, and is
// deliberately never the source of an answer — it is there to be read past.
//
// Ranges are chosen so the arithmetic stays mental: nothing here needs long
// division, which keeps the test about finding the figure rather than about
// grinding through it.
//
// FIELD LABELS MUST BE UNIQUE ACROSS THE WHOLE CATALOGUE. Generic joins name a
// field by its label alone and never say which tab it is on — that is the search
// the test is measuring. Two tabs carrying a "Filter interval" would make such a
// question ambiguous rather than hard. `sltGenerator.test.js` pins uniqueness.

const TAB_SPECS = [
  {
    id: 'apu',
    title: 'Auxiliary Power Unit',
    blurb: 'The APU is started from the battery bus and supplies electrical power and bleed air on the ground. It is not cleared for use above 20,000 ft.',
    fields: [
      { key: 'oilBurn',   label: 'Oil consumption',    unit: 'L/hr', min: 2,  max: 9,  step: 1 },
      { key: 'output',    label: 'Electrical output',  unit: 'kW',   min: 40, max: 90, step: 10 },
      { key: 'maxRun',    label: 'Max continuous run', unit: 'hr',   min: 3,  max: 9,  step: 1 },
      { key: 'startAmps', label: 'Start current draw', unit: 'A',    min: 60, max: 180, step: 20 },
    ],
  },
  {
    id: 'hydraulic',
    title: 'Hydraulic System',
    blurb: 'Two independent circuits, green and yellow, each with its own engine-driven pump. Loss of one circuit leaves the aircraft fully controllable at reduced surface rates.',
    fields: [
      { key: 'reservoir', label: 'Reservoir capacity', unit: 'L',    min: 12, max: 40, step: 4 },
      { key: 'flow',      label: 'Pump flow rate',     unit: 'L/min', min: 2, max: 8,  step: 2 },
      { key: 'pressure',  label: 'Operating pressure', unit: 'psi',  min: 2400, max: 4000, step: 200 },
      { key: 'filter',    label: 'Filter change interval', unit: 'hr', min: 200, max: 600, step: 100 },
    ],
  },
  {
    id: 'electrical',
    title: 'Electrical',
    blurb: 'Each engine drives an integrated drive generator feeding its own AC bus. The buses can be tied through the cross-tie contactor when a generator is lost.',
    fields: [
      // Floor of 100 kW is load-bearing: `join-apu-vs-generator` subtracts the
      // APU's output (max 90) from this, and a generator that could be weaker
      // than the APU would make that question's answer negative.
      { key: 'genOutput', label: 'Generator output',   unit: 'kW',  min: 100, max: 180, step: 20 },
      { key: 'battery',   label: 'Battery capacity',   unit: 'Ah',  min: 20, max: 60,  step: 5 },
      { key: 'busVolts',  label: 'AC bus voltage',     unit: 'V',   min: 110, max: 200, step: 5 },
      { key: 'truRating', label: 'TRU rating',         unit: 'A',   min: 40, max: 120, step: 10 },
    ],
  },
  {
    id: 'fuel',
    title: 'Fuel',
    blurb: 'Wing tanks feed their own side by gravity; the centre tank transfers outboard under pump pressure. Crossfeed is available but is not used in normal operation.',
    fields: [
      { key: 'capacity',  label: 'Total usable fuel',  unit: 'L',     min: 4000, max: 12000, step: 1000 },
      { key: 'transfer',  label: 'Transfer rate',      unit: 'L/min', min: 100, max: 500, step: 100 },
      { key: 'burn',      label: 'Cruise consumption', unit: 'L/hr',  min: 400, max: 1200, step: 100 },
      { key: 'reserve',   label: 'Reserve required',   unit: 'L',     min: 300, max: 900, step: 100 },
    ],
  },
  {
    id: 'deice',
    title: 'De-Icing',
    blurb: 'Electrically heated panels on the leading edges and the intake lip. Panels cycle in sequence rather than together, to keep the peak load off the generator.',
    fields: [
      { key: 'panels',    label: 'Heated panels fitted', unit: '',     min: 6,  max: 18, step: 2 },
      { key: 'drawEach',  label: 'Draw per panel',       unit: 'kW',   min: 2,  max: 9,  step: 1 },
      { key: 'cycle',     label: 'Cycle duration',       unit: 'min',  min: 2,  max: 8,  step: 1 },
      { key: 'minTemp',   label: 'Lower operating limit', unit: '°C',  min: -40, max: -10, step: 5 },
    ],
  },
  {
    id: 'ecs',
    title: 'Environmental Control',
    blurb: 'Two air-cycle packs share the conditioning load. Either pack alone can hold cabin altitude at any cleared flight level, at a reduced flow.',
    fields: [
      // Floor of 30 keeps `join-ecs-vs-avcool` positive against the cooling
      // fan's ceiling of 20.
      { key: 'bleedFlow', label: 'Bleed air flow',     unit: 'kg/min', min: 30, max: 80, step: 10 },
      { key: 'packs',     label: 'Conditioning packs', unit: '',       min: 2,  max: 4,  step: 1 },
      { key: 'cabinAlt',  label: 'Max cabin altitude', unit: 'ft',     min: 6000, max: 9000, step: 500 },
      { key: 'ductTemp',  label: 'Max duct temperature', unit: '°C',   min: 180, max: 260, step: 20 },
    ],
  },
  {
    id: 'gear',
    title: 'Landing Gear',
    blurb: 'Retraction is hydraulic with a free-fall alternate extension. The gear is placarded for extension at any speed below the limiting Mach number.',
    fields: [
      { key: 'retract',   label: 'Retraction time',    unit: 's',   min: 6,  max: 16, step: 2 },
      { key: 'tyre',      label: 'Tyre pressure',      unit: 'psi', min: 120, max: 260, step: 20 },
      { key: 'brakeWear', label: 'Brake wear limit',   unit: 'mm',  min: 3,  max: 12, step: 1 },
      { key: 'cycles',    label: 'Cycles between inspections', unit: '', min: 200, max: 800, step: 100 },
    ],
  },
  {
    id: 'avcool',
    title: 'Avionics Cooling',
    blurb: 'A dedicated fan draws cabin air through the racks and dumps it overboard. Rack temperature is the only cooling parameter presented to the crew.',
    fields: [
      // Fan flow floors at 12 so `avcool-flow-per-rack` always divides to at
      // least 1 against the rack ceiling of 9.
      { key: 'fanFlow',   label: 'Fan flow',           unit: 'm³/min', min: 12, max: 20, step: 2 },
      { key: 'racks',     label: 'Racks cooled',       unit: '',       min: 3,  max: 9,  step: 1 },
      { key: 'maxTemp',   label: 'Max rack temperature', unit: '°C',   min: 45, max: 80, step: 5 },
      // Capped at 200 so it never exceeds the hydraulic filter interval's floor
      // of 200 — `join-avcool-vs-hyd` divides one by the other.
      { key: 'filterHrs', label: 'Cooling filter interval', unit: 'hr', min: 100, max: 200, step: 100 },
    ],
  },

  // ── The seven tabs added to reach the fifteen the corpus describes ─────────
  // These carry no templates of their own. They do not need any: every one of
  // them shares units with the tabs above, so the generic joins can always build
  // a question from them. What they add is the SEARCH — fifteen places a figure
  // could be living instead of eight.
  {
    id: 'pneumatic',
    title: 'Pneumatic',
    blurb: 'Engine bleed feeds a common duct through an isolation valve on each side. The duct is shared with the anti-ice and pressurisation systems, so a leak is felt everywhere at once.',
    fields: [
      { key: 'ductPressure', label: 'Duct pressure',       unit: 'psi',    min: 30, max: 60, step: 5 },
      { key: 'isolValves',   label: 'Isolation valves fitted', unit: '',   min: 2,  max: 6,  step: 1 },
      { key: 'crossFlow',    label: 'Cross-bleed flow',    unit: 'kg/min', min: 10, max: 28, step: 2 },
      { key: 'overheat',     label: 'Duct overheat warning point', unit: '°C', min: 200, max: 280, step: 20 },
    ],
  },
  {
    id: 'oxygen',
    title: 'Oxygen',
    blurb: 'Gaseous oxygen is stored in a single charged cylinder feeding every mask through a common regulator. There is no chemical generator fitted.',
    fields: [
      { key: 'cylinder',   label: 'Cylinder capacity',     unit: 'L',     min: 40, max: 120, step: 20 },
      { key: 'crewFlow',   label: 'Crew flow rate',        unit: 'L/min', min: 2,  max: 8,   step: 2 },
      { key: 'chargePsi',  label: 'Cylinder charge pressure', unit: 'psi', min: 1600, max: 2400, step: 200 },
      { key: 'masks',      label: 'Masks fitted',          unit: '',      min: 3,  max: 9,   step: 1 },
    ],
  },
  {
    id: 'fire',
    title: 'Fire Protection',
    blurb: 'Each engine bay carries its own detector loop and can be served by either extinguisher bottle. A single discharge empties one bottle completely.',
    fields: [
      { key: 'bottles',   label: 'Extinguisher bottles',  unit: '',    min: 2,  max: 6,  step: 1 },
      { key: 'discharge', label: 'Bottle discharge time', unit: 's',   min: 4,  max: 14, step: 2 },
      { key: 'loops',     label: 'Detector loops fitted', unit: '',    min: 2,  max: 8,  step: 2 },
      { key: 'bayLimit',  label: 'Bay temperature limit', unit: '°C',  min: 300, max: 460, step: 20 },
    ],
  },
  {
    id: 'controls',
    title: 'Flight Controls',
    blurb: 'Every primary surface is driven by its own actuators off the hydraulic circuits. Trim runs on a separate electric motor and is unaffected by a hydraulic failure.',
    fields: [
      { key: 'actuators', label: 'Actuators per surface',  unit: '',    min: 2,  max: 4,  step: 1 },
      { key: 'travel',    label: 'Full-travel time',       unit: 's',   min: 2,  max: 8,  step: 2 },
      { key: 'actPsi',    label: 'Actuator supply pressure', unit: 'psi', min: 2600, max: 3800, step: 200 },
      { key: 'trimDraw',  label: 'Trim motor current',     unit: 'A',   min: 10, max: 50, step: 10 },
    ],
  },
  {
    id: 'radar',
    title: 'Radar',
    blurb: 'A mechanically scanned antenna behind the radome, cooled by its own tapping off the avionics air. Transmit is inhibited on the ground unless the test switch is made.',
    fields: [
      { key: 'txPower',   label: 'Transmit power',        unit: 'kW',     min: 10, max: 70, step: 10 },
      { key: 'scan',      label: 'Scan period',           unit: 's',      min: 3,  max: 9,  step: 2 },
      { key: 'radarCool', label: 'Radar cooling demand',  unit: 'm³/min', min: 2,  max: 8,  step: 2 },
      { key: 'tiltLimit', label: 'Antenna tilt limit',    unit: '°',      min: 10, max: 30, step: 5 },
    ],
  },
  {
    id: 'comms',
    title: 'Communications',
    blurb: 'Two identical transceivers share a set of antennas through a switching unit. The standby battery carries the sets alone with every generator lost.',
    fields: [
      { key: 'radios',    label: 'Radio sets fitted',     unit: '',    min: 2,  max: 6,  step: 1 },
      { key: 'setDraw',   label: 'Radio set power draw',  unit: 'kW',  min: 1,  max: 5,  step: 1 },
      { key: 'standby',   label: 'Standby battery life',  unit: 'min', min: 20, max: 90, step: 10 },
      { key: 'antennas',  label: 'Antennas fitted',       unit: '',    min: 2,  max: 8,  step: 2 },
    ],
  },
  {
    id: 'nav',
    title: 'Navigation',
    blurb: 'Inertial units are aligned on the ground and must not be moved during alignment. Position is blended with satellite fixes once airborne.',
    fields: [
      { key: 'inertial',  label: 'Inertial units fitted', unit: '',      min: 2,  max: 4,  step: 1 },
      { key: 'align',     label: 'Alignment time',        unit: 'min',   min: 5,  max: 20, step: 5 },
      { key: 'navDraw',   label: 'Inertial unit current', unit: 'A',     min: 5,  max: 25, step: 5 },
      { key: 'driftLimit', label: 'Drift rate limit',     unit: 'nm/hr', min: 1,  max: 4,  step: 1 },
    ],
  },
]

// ── Question templates ───────────────────────────────────────────────────────
// `needs` lists the tab ids a template reads. One id = a single-hop question
// (everything is on one tab); two ids = the player has to hold a figure from one
// tab while they go and find another. `build` returns { prompt, answer, unit }.
//
// Every answer is a whole number by construction. Where a template divides, it
// either divides values chosen from compatible steps or floors the result and
// says so in the prompt, so no question ever turns on a rounding convention the
// player was not told about.

// The single-hop templates below are now a LAST RESORT rather than the staple.
// Every question a normal run serves is a join, because the corpus says no
// single tab answers a question. These stay because a draw that somehow left no
// join available should still produce a playable run rather than a short one —
// and because they cost nothing to keep. Tabs added later need none of their
// own: the generic joins cover any tab that shares a unit with another.
const TEMPLATES = [
  // ── APU ────────────────────────────────────────────────────────────────────
  {
    id: 'apu-oil-hours',
    needs: ['apu'],
    build: (t, rng) => {
      const hours = 3 + Math.floor(rng() * 6)
      return { prompt: `The APU is run for ${hours} hours. How much oil does it consume?`, answer: t.apu.oilBurn * hours, unit: 'L' }
    },
  },
  {
    id: 'apu-oil-to-limit',
    needs: ['apu'],
    build: (t) => ({
      prompt: 'The APU is run from cold to its continuous limit. How much oil does it consume?',
      answer: t.apu.oilBurn * t.apu.maxRun, unit: 'L',
    }),
  },
  {
    id: 'apu-starts-draw',
    needs: ['apu'],
    build: (t, rng) => {
      const starts = 2 + Math.floor(rng() * 4)
      return { prompt: `${starts} APU starts are attempted back to back. What is the total current drawn?`, answer: t.apu.startAmps * starts, unit: 'A' }
    },
  },

  // ── Hydraulic ──────────────────────────────────────────────────────────────
  {
    id: 'hyd-reservoir-fill',
    needs: ['hydraulic'],
    build: (t) => ({
      prompt: 'Starting from empty, how long does one pump take to fill the hydraulic reservoir?',
      answer: Math.floor(t.hydraulic.reservoir / t.hydraulic.flow), unit: 'min',
    }),
  },
  {
    id: 'hyd-both-pumps',
    needs: ['hydraulic'],
    build: (t) => ({
      prompt: 'Both engine-driven pumps run together. What is the combined flow?',
      answer: t.hydraulic.flow * 2, unit: 'L/min',
    }),
  },
  {
    id: 'hyd-filters-in-life',
    needs: ['hydraulic'],
    build: (t, rng) => {
      const hours = (2 + Math.floor(rng() * 4)) * t.hydraulic.filter
      return { prompt: `Over ${hours} flying hours, how many hydraulic filter changes fall due?`, answer: Math.floor(hours / t.hydraulic.filter), unit: 'changes' }
    },
  },

  // ── Electrical ─────────────────────────────────────────────────────────────
  {
    id: 'elec-both-generators',
    needs: ['electrical'],
    build: (t) => ({
      prompt: 'Both generators are on line. What is the total electrical output available?',
      answer: t.electrical.genOutput * 2, unit: 'kW',
    }),
  },
  {
    id: 'elec-tru-load',
    needs: ['electrical'],
    build: (t, rng) => {
      const count = 2 + Math.floor(rng() * 3)
      return { prompt: `${count} transformer rectifier units are carrying their full rating. What is the total DC current?`, answer: t.electrical.truRating * count, unit: 'A' }
    },
  },
  {
    id: 'elec-battery-at-rating',
    needs: ['electrical'],
    build: (t) => ({
      prompt: 'A load equal to one TRU rating is placed on the battery. How many whole minutes will it last?',
      answer: Math.floor((t.electrical.battery * 60) / t.electrical.truRating), unit: 'min',
    }),
  },

  // ── Fuel ───────────────────────────────────────────────────────────────────
  {
    id: 'fuel-endurance',
    needs: ['fuel'],
    build: (t) => ({
      prompt: 'Ignoring the reserve requirement, how many whole hours can the aircraft cruise on full tanks?',
      answer: Math.floor(t.fuel.capacity / t.fuel.burn), unit: 'hr',
    }),
  },
  {
    id: 'fuel-usable-after-reserve',
    needs: ['fuel'],
    build: (t) => ({
      prompt: 'How much fuel is available for the trip once the required reserve is set aside?',
      answer: t.fuel.capacity - t.fuel.reserve, unit: 'L',
    }),
  },
  {
    id: 'fuel-transfer-time',
    needs: ['fuel'],
    build: (t) => ({
      prompt: 'How many whole minutes would it take to transfer the full tank contents at the stated rate?',
      answer: Math.floor(t.fuel.capacity / t.fuel.transfer), unit: 'min',
    }),
  },

  // ── De-icing ───────────────────────────────────────────────────────────────
  {
    id: 'deice-total-load',
    needs: ['deice'],
    build: (t) => ({
      prompt: 'If every heated panel were energised at once, what would the total de-icing load be?',
      answer: t.deice.panels * t.deice.drawEach, unit: 'kW',
    }),
  },
  {
    id: 'deice-full-pass',
    needs: ['deice'],
    build: (t) => ({
      prompt: 'Panels cycle one after another, not together. How long does one pass through every panel take?',
      answer: t.deice.panels * t.deice.cycle, unit: 'min',
    }),
  },
  {
    id: 'deice-half-bank',
    needs: ['deice'],
    build: (t) => ({
      prompt: 'Half the panels are isolated after a fault. What load do the remaining panels draw together?',
      answer: (t.deice.panels / 2) * t.deice.drawEach, unit: 'kW',
    }),
  },

  // ── Environmental control ──────────────────────────────────────────────────
  {
    id: 'ecs-flow-per-pack',
    needs: ['ecs'],
    build: (t) => ({
      prompt: 'Bleed flow is shared equally between the packs. How much reaches each one?',
      answer: Math.floor(t.ecs.bleedFlow / t.ecs.packs), unit: 'kg/min',
    }),
  },
  {
    id: 'ecs-one-pack-lost',
    needs: ['ecs'],
    build: (t) => ({
      prompt: 'One pack fails and its share of the bleed flow is shut off. How much flow is still being conditioned?',
      answer: Math.floor(t.ecs.bleedFlow / t.ecs.packs) * (t.ecs.packs - 1), unit: 'kg/min',
    }),
  },
  {
    id: 'ecs-flow-over-time',
    needs: ['ecs'],
    build: (t, rng) => {
      const mins = 5 + Math.floor(rng() * 6)
      return { prompt: `How much bleed air passes through the system in ${mins} minutes?`, answer: t.ecs.bleedFlow * mins, unit: 'kg' }
    },
  },

  // ── Landing gear ───────────────────────────────────────────────────────────
  {
    id: 'gear-cycle-time',
    needs: ['gear'],
    build: (t, rng) => {
      const cycles = 3 + Math.floor(rng() * 5)
      return { prompt: `How long do ${cycles} complete gear retractions take?`, answer: t.gear.retract * cycles, unit: 's' }
    },
  },
  {
    id: 'gear-inspections',
    needs: ['gear'],
    build: (t, rng) => {
      const mult = 2 + Math.floor(rng() * 4)
      return { prompt: `After ${t.gear.cycles * mult} gear cycles, how many inspections have fallen due?`, answer: mult, unit: 'inspections' }
    },
  },
  {
    id: 'gear-brake-remaining',
    needs: ['gear'],
    build: (t, rng) => {
      const worn = 1 + Math.floor(rng() * Math.max(1, t.gear.brakeWear - 1))
      return { prompt: `A brake pack measures ${worn} mm of wear. How much wear remains before the limit?`, answer: t.gear.brakeWear - worn, unit: 'mm' }
    },
  },

  // ── Avionics cooling ───────────────────────────────────────────────────────
  {
    id: 'avcool-flow-per-rack',
    needs: ['avcool'],
    build: (t) => ({
      prompt: 'Fan flow is split evenly across the racks. How much does each rack receive?',
      answer: Math.floor(t.avcool.fanFlow / t.avcool.racks), unit: 'm³/min',
    }),
  },
  {
    id: 'avcool-filters',
    needs: ['avcool'],
    build: (t, rng) => {
      const mult = 2 + Math.floor(rng() * 4)
      return { prompt: `Over ${t.avcool.filterHrs * mult} flying hours, how many cooling filter changes fall due?`, answer: mult, unit: 'changes' }
    },
  },
  {
    id: 'avcool-margin',
    needs: ['avcool'],
    build: (t, rng) => {
      const observed = t.avcool.maxTemp - (5 + Math.floor(rng() * 6) * 2)
      return { prompt: `A rack is reading ${observed} °C. How far is it below the maximum?`, answer: t.avcool.maxTemp - observed, unit: '°C' }
    },
  },

  // ── Two-tab joins ──────────────────────────────────────────────────────────
  // Hard's questions come from here first. Every pair below is spread across the
  // catalogue so that any six-tab draw leaves several of them usable.
  {
    id: 'join-deice-on-generator',
    needs: ['electrical', 'deice'],
    build: (t) => ({
      prompt: 'A single generator is carrying the de-icing load and nothing else. How many panels can it energise at the same time?',
      answer: Math.floor(t.electrical.genOutput / t.deice.drawEach), unit: 'panels',
    }),
  },
  {
    id: 'join-apu-vs-generator',
    needs: ['apu', 'electrical'],
    build: (t) => ({
      prompt: 'How much less electrical power does the APU supply than one generator?',
      answer: t.electrical.genOutput - t.apu.output, unit: 'kW',
    }),
  },
  {
    id: 'join-battery-start',
    needs: ['electrical', 'apu'],
    build: (t) => ({
      prompt: 'Ignoring every other load, how many whole minutes of APU start current would the battery support?',
      answer: Math.floor((t.electrical.battery * 60) / t.apu.startAmps), unit: 'min',
    }),
  },
  {
    id: 'join-apu-run-vs-cruise-burn',
    needs: ['apu', 'fuel'],
    build: (t) => ({
      prompt: 'The APU is run to its continuous limit. How much fuel would the aircraft have burned in cruise over the same period?',
      answer: t.apu.maxRun * t.fuel.burn, unit: 'L',
    }),
  },
  {
    id: 'join-ecs-vs-avcool',
    needs: ['ecs', 'avcool'],
    build: (t) => ({
      // Total bleed flow against fan flow, not per-pack against fan flow: the
      // per-pack figure can fall below the fan's on a low bleed roll, and a
      // negative answer reads as a broken question rather than a hard one.
      prompt: 'By how much does the total bleed air flow exceed the avionics cooling fan flow?',
      answer: t.ecs.bleedFlow - t.avcool.fanFlow, unit: 'units',
    }),
  },
  {
    id: 'join-hyd-fill-vs-gear',
    needs: ['hydraulic', 'gear'],
    build: (t) => ({
      prompt: 'How many complete gear retractions could be run in the time one pump takes to fill the reservoir from empty?',
      answer: Math.floor((Math.floor(t.hydraulic.reservoir / t.hydraulic.flow) * 60) / t.gear.retract), unit: 'retractions',
    }),
  },
  {
    id: 'join-deice-pass-vs-fuel',
    needs: ['deice', 'fuel'],
    build: (t) => ({
      prompt: 'How much fuel is burned in cruise during one complete pass through every de-icing panel?',
      answer: Math.floor((t.deice.panels * t.deice.cycle * t.fuel.burn) / 60), unit: 'L',
    }),
  },
  {
    id: 'join-generators-vs-deice-and-avcool',
    needs: ['electrical', 'avcool'],
    build: (t) => ({
      prompt: 'Both generators are on line. How many racks-worth of the total output is that per rack cooled?',
      answer: Math.floor((t.electrical.genOutput * 2) / t.avcool.racks), unit: 'kW',
    }),
  },
  {
    id: 'join-fuel-transfer-vs-hyd',
    needs: ['fuel', 'hydraulic'],
    build: (t) => ({
      prompt: 'How many times faster is the fuel transfer rate than one hydraulic pump?',
      answer: Math.floor(t.fuel.transfer / t.hydraulic.flow), unit: '×',
    }),
  },
  {
    id: 'join-apu-output-vs-deice',
    needs: ['apu', 'deice'],
    build: (t) => ({
      prompt: 'The APU alone is carrying the de-icing load. How many panels can it energise at the same time?',
      answer: Math.floor(t.apu.output / t.deice.drawEach), unit: 'panels',
    }),
  },
  {
    id: 'join-ecs-vs-gear',
    needs: ['ecs', 'gear'],
    build: (t) => ({
      prompt: 'How much bleed air passes through the system during one complete gear retraction?',
      answer: Math.floor((t.ecs.bleedFlow * t.gear.retract) / 60), unit: 'kg',
    }),
  },
  {
    id: 'join-avcool-vs-hyd',
    needs: ['avcool', 'hydraulic'],
    build: (t) => ({
      prompt: 'How many cooling filter intervals fit inside one hydraulic filter interval? Round down.',
      answer: Math.floor(t.hydraulic.filter / t.avcool.filterHrs), unit: 'intervals',
    }),
  },
]

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function rollField(spec, rng) {
  const steps = Math.floor((spec.max - spec.min) / spec.step) + 1
  return spec.min + Math.floor(rng() * steps) * spec.step
}

// ── Generic joins ────────────────────────────────────────────────────────────
// Any two fields on DIFFERENT tabs that share a unit can be compared. That is
// what lets every question be a join across a fifteen-tab index without
// hand-writing a template for every pair — and it means a tab earns its place in
// the catalogue by sharing a unit with something, not by carrying templates.
//
// Fields are named by their LABEL and never by their tab, because finding which
// tab a figure lives on is the whole task. Labels are unique across the
// catalogue for exactly that reason.
//
// Two shapes only, both of which are always whole, always positive and always
// grammatical whatever the two fields turn out to be:
//
//   • the difference, ordered largest first so it can never come out negative
//   • the ratio, offered only when it is at least 2 (a ratio of 1 is not a
//     question) and the smaller figure is positive (some limits are below zero)
function genericJoins(tabs, rng) {
  const byUnit = new Map()
  for (const tab of tabs) {
    for (const f of tab.fields) {
      if (!byUnit.has(f.unit)) byUnit.set(f.unit, [])
      byUnit.get(f.unit).push({ ...f, tabId: tab.id })
    }
  }

  const out = []
  for (const fields of byUnit.values()) {
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const [x, y] = [fields[i], fields[j]]
        if (x.tabId === y.tabId) continue
        const [big, small] = x.value >= y.value ? [x, y] : [y, x]
        const needs = [big.tabId, small.tabId]

        if (big.value !== small.value) {
          out.push({
            id: `diff-${big.tabId}.${big.key}-${small.tabId}.${small.key}`,
            needs,
            make: () => ({
              prompt: `Find both figures. How much greater is ${big.label} than ${small.label}?`,
              answer: big.value - small.value,
              unit: big.unit,
            }),
          })
        }

        if (small.value > 0 && Math.floor(big.value / small.value) >= 2) {
          out.push({
            id: `ratio-${big.tabId}.${big.key}-${small.tabId}.${small.key}`,
            needs,
            make: () => ({
              prompt: `Find both figures. How many times greater is ${big.label} than ${small.label}? Round down.`,
              answer: Math.floor(big.value / small.value),
              unit: '×',
            }),
          })
        }
      }
    }
  }
  return shuffle(out, rng)
}

// Four options: the answer plus three near-misses. Distractors are scaled to the
// answer rather than fixed, so a 12,000 L question does not offer 12,000 / 12,001
// / 12,002 and give itself away.
function buildOptions(answer, rng) {
  const magnitude = Math.max(1, Math.round(Math.abs(answer) * 0.15))
  const opts = new Set([answer])
  let guard = 0
  while (opts.size < 4 && guard++ < 100) {
    const delta = (1 + Math.floor(rng() * 3)) * magnitude
    const candidate = rng() < 0.5 ? answer + delta : answer - delta
    if (candidate !== answer) opts.add(candidate)
  }
  // Degenerate case (answer 0 with tiny magnitude) — walk out by whole numbers.
  let filler = 1
  while (opts.size < 4) { opts.add(answer + filler); filler++ }
  return shuffle([...opts], rng)
}

export function generateSltSystem({ tabCount, questionCount }, rng = Math.random) {
  const specs = shuffle(TAB_SPECS, rng).slice(0, tabCount)

  // Roll the figures for each chosen tab, and keep a flat { tabId: { key: value } }
  // lookup for the templates.
  const values = {}
  const tabs = specs.map(spec => {
    values[spec.id] = {}
    const fields = spec.fields.map(f => {
      const value = rollField(f, rng)
      values[spec.id][f.key] = value
      return { key: f.key, label: f.label, value, unit: f.unit }
    })
    return { id: spec.id, title: spec.title, blurb: spec.blurb, fields }
  })

  const present = new Set(specs.map(s => s.id))
  const usable = TEMPLATES.filter(t => t.needs.every(id => present.has(id)))
  const asCandidate = (t) => ({ id: t.id, needs: t.needs, make: () => t.build(values, rng) })

  // "No single tab answers a question", on both difficulties. Hand-written joins
  // first because they carry the interesting arithmetic, then generic joins,
  // which exist so the supply never runs out whatever the draw. Single-tab
  // lookups sit at the very back as a last resort and should never be reached —
  // `sltGenerator.test.js` pins that every question on a normal run is a join.
  const remaining = [
    ...shuffle(usable.filter(t => t.needs.length > 1), rng).map(asCandidate),
    ...genericJoins(tabs, rng),
    ...shuffle(usable.filter(t => t.needs.length === 1), rng).map(asCandidate),
  ]

  // Order so no two consecutive questions read the same tab. The bottleneck the
  // real test punishes is FINDING the tab, and leaving two questions on one tab
  // adjacent would hand the second one for free. Preference only — if nothing
  // disjoint is left, the next question is taken rather than the run cut short.
  const questions = []
  let lastTabs = new Set()
  while (questions.length < questionCount && remaining.length) {
    let idx = remaining.findIndex(t => !t.needs.some(id => lastTabs.has(id)))
    if (idx < 0) idx = 0
    const [tpl] = remaining.splice(idx, 1)
    const { prompt, answer, unit } = tpl.make()
    questions.push({
      id: `${tpl.id}-${questions.length}`,
      prompt,
      answer,
      unit,
      options: buildOptions(answer, rng),
      hops: tpl.needs.length,
      tabIds: tpl.needs,
    })
    lastTabs = new Set(tpl.needs)
  }

  return {
    name: 'Airframe Systems Brief',
    tabs,
    questions,
  }
}

// Exported for the test that pins "every tab carries at least three single-hop
// templates". Named so it is obvious at the call site that these are internals,
// not part of the generator's contract.
export const TAB_SPECS_FOR_TEST = TAB_SPECS
export const TEMPLATES_FOR_TEST = TEMPLATES
