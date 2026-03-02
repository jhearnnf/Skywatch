const IntelligenceBrief = require('../models/IntelligenceBrief');
const Media = require('../models/Media');

async function seedBriefs() {
  const count = await IntelligenceBrief.countDocuments();
  if (count > 0) return;

  // Get or create placeholder media
  let placeholder = await Media.findOne({ mediaUrl: '/placeholder-brief.svg' });
  if (!placeholder) {
    placeholder = await Media.create({ mediaType: 'picture', mediaUrl: '/placeholder-brief.svg' });
  }
  const pid = placeholder._id;

  const now = new Date();
  const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000);

  const briefs = [

    // ── 3 × News ────────────────────────────────────────────────────────────

    {
      category: 'News',
      title: 'RAF Typhoons Scrambled to Intercept Russian Aircraft Over North Sea',
      subtitle: 'QRA aircraft from RAF Lossiemouth tracked and escorted two Tu-95 Bear bombers',
      description: `Royal Air Force Typhoon FGR4 aircraft were scrambled from RAF Lossiemouth on Quick Reaction Alert duty after two Russian Tupolev Tu-95 Bear strategic bombers were detected approaching UK airspace over the North Sea. The aircraft, from No. 6 Squadron, intercepted the bombers approximately 40 nautical miles from the UK Air Defence Identification Zone and shadowed them for ninety minutes before the Russian aircraft turned back toward international airspace. This marks the third such intercept this year, continuing a pattern of Russian long-range aviation probing NATO member defences. Wing Commander Sarah Hutchings stated the response was executed flawlessly and serves as a reminder of the RAF's commitment to protecting sovereign airspace. The incident was coordinated with NATO's Combined Air Operations Centre and monitored by the E-3D Sentry orbiting over the North Sea. No hostile intent was assessed by intelligence analysts following the intercept.`,
      sources: [{ url: 'https://www.raf.mod.uk', siteName: 'RAF.mod.uk', articleDate: daysAgo(1) }],
      keywords: [
        { keyword: 'Quick Reaction Alert', generatedDescription: 'QRA: A standing readiness posture requiring aircraft to be airborne within minutes of scramble.' },
        { keyword: 'Typhoon FGR4', generatedDescription: "The RAF's primary multi-role combat aircraft, capable of both air-to-air and air-to-ground roles." },
        { keyword: 'ADIZ', generatedDescription: 'Air Defence Identification Zone: designated airspace within which identification of all aircraft is required.' },
      ],
      media: [pid],
      dateAdded: daysAgo(1),
    },

    {
      category: 'News',
      title: 'F-35B Lightning Squadron Declared Fully Operational at RAF Marham',
      subtitle: 'No. 617 Squadron achieves Initial Operating Capability milestone after intensive work-up',
      description: `No. 617 Squadron "The Dambusters" has been formally declared at Initial Operating Capability with the F-35B Lightning stealth multirole aircraft following a rigorous work-up programme at RAF Marham in Norfolk. The declaration was made by Air Officer Commanding 1 Group during a ceremony attended by senior RAF leadership and defence industry partners. IOC confirms the squadron can generate, deploy, and sustain a minimum combat-capable force across a range of operational scenarios. The Lightning's advanced sensors, stealth characteristics, and networked data-sharing represent a significant leap in RAF offensive capability. The F-35B variant is specifically configured for Short Take-Off and Vertical Landing, enabling operations from both land bases and the Queen Elizabeth-class aircraft carriers HMS Queen Elizabeth and HMS Prince of Wales. Follow-on training exercises are planned with US Marine Corps F-35B units later this year to consolidate interoperability procedures.`,
      sources: [{ url: 'https://www.gov.uk/government/organisations/ministry-of-defence', siteName: 'Ministry of Defence', articleDate: daysAgo(2) }],
      keywords: [
        { keyword: 'Initial Operating Capability', generatedDescription: 'IOC: The point at which a unit has the minimum essential resources to employ and sustain a capability.' },
        { keyword: 'STOVL', generatedDescription: 'Short Take-Off and Vertical Landing: an aircraft capability enabling operations from short runways and ship flight decks.' },
        { keyword: 'stealth', generatedDescription: "Low-observable technology that reduces an aircraft's radar, infrared, and acoustic signatures to complicate detection." },
      ],
      media: [pid],
      dateAdded: daysAgo(2),
    },

    {
      category: 'News',
      title: 'Exercise ATLANTIC STRIKE Tests RAF Long-Range Strike Capability',
      subtitle: 'Typhoon and Voyager crews complete 10-hour mission profile across Atlantic corridor',
      description: `RAF Typhoon FGR4 aircraft, supported by an A330 Voyager tanker, have completed Exercise ATLANTIC STRIKE — a demanding long-range strike training mission designed to validate the UK's ability to project air power at strategic distances. The exercise saw four Typhoons conduct multiple air-to-air refuelling brackets with the Voyager tanker before executing simulated strike profiles against designated target areas in the mid-Atlantic exercise corridor. Total mission duration exceeded ten hours, with pilots operating at the edge of their endurance envelope. Group Captain James Forsyth, Exercise Director, stated the mission proved the RAF can reach, strike, and return from targets well beyond land-based tactical fighter range. Strategic strike capability is central to the UK Integrated Review's emphasis on conventional deterrence. The exercise also tested coordination between 1 Group and No. 10 Squadron, which operates the Voyager tanker fleet from RAF Brize Norton.`,
      sources: [{ url: 'https://www.raf.mod.uk', siteName: 'RAF.mod.uk', articleDate: daysAgo(3) }],
      keywords: [
        { keyword: 'air-to-air refuelling', generatedDescription: 'AAR: The transfer of fuel from a tanker to a receiver aircraft while both are in flight, extending range and endurance.' },
        { keyword: 'Voyager', generatedDescription: 'The RAF designation for the Airbus A330 MRTT, used for strategic air transport and air-to-air refuelling.' },
      ],
      media: [pid],
      dateAdded: daysAgo(3),
    },

    // ── 2 × Aircrafts ────────────────────────────────────────────────────────

    {
      category: 'Aircrafts',
      title: 'Eurofighter Typhoon FGR4',
      subtitle: "The RAF's primary swing-role combat aircraft and backbone of UK air defence",
      description: `The Eurofighter Typhoon FGR4 is the Royal Air Force's principal multi-role combat aircraft, forming the backbone of both UK air defence and offensive air power. Developed through a multinational European consortium and entering RAF service in 2003, the Typhoon is a highly agile, supersonic, canard-delta wing fighter capable of exceeding Mach 2. The FGR4 variant is the definitive RAF configuration, equipped with the CAPTOR-E AESA radar, the PIRATE infrared search and track sensor, and a comprehensive defensive aids suite. Its weapons payload includes ASRAAM, Meteor, AMRAAM, Brimstone, Storm Shadow, and Paveway IV, giving it formidable beyond-visual-range air combat, close-in air combat, and precision strike capability. The aircraft operates from RAF Lossiemouth, RAF Coningsby, and RAF Akrotiri, and provides QRA cover for the UK and Falkland Islands. With the introduction of the F-35B, the Typhoon's role is evolving toward electronic warfare and deep strike missions, extending its operational life well into the 2040s.`,
      sources: [{ url: 'https://www.raf.mod.uk/aircraft/typhoon/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'AESA radar', generatedDescription: 'Active Electronically Scanned Array: an advanced radar that steers its beam electronically, providing superior multi-target tracking.' },
        { keyword: 'Meteor', generatedDescription: 'A beyond-visual-range air-to-air missile with a ramjet motor, offering greatly extended no-escape zones.' },
        { keyword: 'canard-delta', generatedDescription: 'An aerodynamic configuration combining a delta wing with small foreplanes, providing exceptional agility.' },
      ],
      media: [pid],
      dateAdded: daysAgo(5),
    },

    {
      category: 'Aircrafts',
      title: 'Boeing RC-135W Rivet Joint',
      subtitle: 'Strategic signals intelligence platform providing persistent theatre ISR capability',
      description: `The Boeing RC-135W Rivet Joint is the Royal Air Force's strategic signals intelligence aircraft, operated by No. 51 Squadron from RAF Waddington. The aircraft is a highly modified C-135 variant packed with sophisticated ELINT and COMINT collection systems capable of detecting, locating, and analysing electromagnetic emissions across an extremely wide spectrum. The RAF operates three Rivet Joints, which replaced the Nimrod R1 fleet following the 2010 Strategic Defence and Security Review. The aircraft provides persistent Intelligence, Surveillance, and Reconnaissance capability, typically orbiting at high altitude for many hours over an area of interest and feeding intelligence data to analysts both on board and at ground exploitation cells. The RC-135W has been deployed on operations over Iraq, Syria, Ukraine, and the broader Euro-Atlantic area. Its intelligence product supports targeting, force protection, and national intelligence assessments at the highest levels of command. The aircraft operates closely with GCHQ and allied partners to fuse signals intelligence across multiple collection platforms.`,
      sources: [{ url: 'https://www.raf.mod.uk/aircraft/rc-135w-rivet-joint/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'SIGINT', generatedDescription: 'Signals Intelligence: intelligence gathered by intercepting signals — including communications and electronic emissions.' },
        { keyword: 'ELINT', generatedDescription: 'Electronic Intelligence: collection and analysis of non-communications electronic signals such as radar emissions.' },
        { keyword: 'ISR', generatedDescription: 'Intelligence, Surveillance, and Reconnaissance: the coordinated collection and processing of information about adversary activities.' },
      ],
      media: [pid],
      dateAdded: daysAgo(6),
    },

    // ── 3 × Bases ────────────────────────────────────────────────────────────

    {
      category: 'Bases',
      title: 'RAF Lossiemouth',
      subtitle: "Scotland's frontline air base and the home of QRA North",
      description: `RAF Lossiemouth, situated on the Moray Firth coast of north-east Scotland, is the RAF's most northerly frontline operating base and serves as the headquarters of Air Command's northern air defence mission. The station is home to four Typhoon FGR4 squadrons — Nos. 1(F), 6, 11(F), and 2 OCU — as well as No. 120 Squadron operating the P-8A Poseidon maritime patrol aircraft. Lossiemouth hosts the northern Quick Reaction Alert commitment, maintaining Typhoons at two minutes' readiness around the clock to intercept aircraft approaching UK airspace from the north and north-west. Its location provides significant geographic advantage for monitoring the Norwegian Sea, the GIUK gap, and Arctic approaches. The base has undergone extensive infrastructure investment under Project MARSHAL, including new hardened aircraft shelters, upgraded fuel systems, and enhanced electronic warfare training ranges. RAF Lossiemouth also supports Exercise JOINT WARRIOR, a twice-yearly multinational exercise drawing maritime, air, and land forces from across NATO.`,
      sources: [{ url: 'https://www.raf.mod.uk/our-organisation/stations/raf-lossiemouth/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'GIUK gap', generatedDescription: 'Greenland-Iceland-UK gap: a strategic maritime choke point through which Russian submarines must transit to reach the Atlantic.' },
        { keyword: 'P-8A Poseidon', generatedDescription: "Boeing's maritime patrol aircraft operated by the RAF for anti-submarine warfare and maritime ISR." },
      ],
      media: [pid],
      dateAdded: daysAgo(7),
    },

    {
      category: 'Bases',
      title: 'RAF Akrotiri',
      subtitle: "UK Sovereign Base Area in Cyprus serving as a strategic hub for Eastern Mediterranean operations",
      description: `RAF Akrotiri forms part of the United Kingdom's Sovereign Base Areas in Cyprus, retained after Cypriot independence in 1960. Located on the southern tip of Cyprus near Limassol, Akrotiri provides the UK with an enduring strategic footprint in the Eastern Mediterranean — approximately 240 kilometres from the Syrian coast. The base has supported nearly continuous combat operations since the first Gulf War, including Operation SHADER — the UK's contribution to the counter-ISIL campaign in Iraq and Syria. The station's geographic position enables rapid power projection into the Middle East, North Africa, and the Caucasus. Akrotiri maintains robust force protection measures including live-fire ranges and an integrated air defence system. It also serves an important humanitarian role, coordinating evacuation operations across the region and hosting disaster relief deployments. The station regularly hosts Typhoon, Sentinel, and Rivet Joint deployments and serves as a forward operating location for coalition air operations.`,
      sources: [{ url: 'https://www.raf.mod.uk/our-organisation/stations/raf-akrotiri/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'Sovereign Base Area', generatedDescription: 'British Overseas Territories within Cyprus giving the UK permanent military basing rights on the island.' },
        { keyword: 'Operation SHADER', generatedDescription: 'The UK military contribution to the coalition campaign against ISIL in Iraq and the Levant.' },
      ],
      media: [pid],
      dateAdded: daysAgo(8),
    },

    {
      category: 'Bases',
      title: 'RAF Brize Norton',
      subtitle: "The RAF's largest station and the hub of UK strategic air transport",
      description: `RAF Brize Norton in Oxfordshire is the largest Royal Air Force station by personnel and one of the most operationally significant bases in the UK. It serves as the home of strategic air transport and air-to-air refuelling, operating the A400M Atlas airlifter and the A330 Voyager tanker transport. Brize Norton is the operational home of No. 10 and No. 101 Squadrons on Voyager, No. 99 Squadron on C-17 Globemaster III, and multiple A400M Atlas squadrons. As the gateway for UK strategic airlift, Brize Norton supports the full spectrum of operational commitments — from non-combatant evacuation operations to humanitarian aid delivery and the continuous air bridge to the Falkland Islands. The Voyager fleet provides the RAF's air-to-air refuelling capability, enabling the extended range of Typhoon on long-range operations. The base also houses the Air Mobility Force and provides joint personnel recovery and parachute training facilities for UK and allied forces.`,
      sources: [{ url: 'https://www.raf.mod.uk/our-organisation/stations/raf-brize-norton/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'A400M Atlas', generatedDescription: 'A European four-engine turboprop military transport combining tactical and strategic airlift capability.' },
        { keyword: 'C-17 Globemaster III', generatedDescription: 'A large military transport aircraft capable of carrying oversized cargo and operating from short, austere airstrips.' },
        { keyword: 'air bridge', generatedDescription: "A regular scheduled air transport route — typically the RAF's service connecting the UK to the Falkland Islands." },
      ],
      media: [pid],
      dateAdded: daysAgo(9),
    },

    // ── 1 × Squadron ─────────────────────────────────────────────────────────

    {
      category: 'Squadrons',
      title: 'No. 617 Squadron "The Dambusters"',
      subtitle: "From the Ruhr dams to stealth strike — the RAF's most celebrated precision attack squadron",
      description: `No. 617 Squadron, universally known as "The Dambusters," holds a uniquely iconic place in RAF history. Formed in March 1943 at RAF Scampton specifically to carry out Operation CHASTISE — the audacious low-level night attack on the Möhne, Eder, and Sorpe dams in Germany's Ruhr industrial heartland — the squadron earned immediate fame through its use of Barnes Wallis's bouncing bomb. Commanded by Wing Commander Guy Gibson VC, the operation successfully breached the Möhne and Eder dams, disrupting German industrial output. In the modern era the squadron was the first RAF unit to convert to the F-35B Lightning, reactivating at RAF Marham in 2018. Today it remains at the cutting edge of RAF strike capability, combining fifth-generation stealth characteristics, advanced sensor fusion, and networked warfare capability to carry on its legacy of precision at range. The squadron badge — a breached dam with waves — and the motto "Après moi, le déluge" remain unchanged, connecting the squadron's past to its future.`,
      sources: [{ url: 'https://www.raf.mod.uk/our-organisation/squadrons/617-squadron/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'Operation CHASTISE', generatedDescription: "The 1943 RAF bombing raid using Barnes Wallis's bouncing bomb to breach the Ruhr valley dams." },
        { keyword: 'bouncing bomb', generatedDescription: 'The Upkeep mine designed by Barnes Wallis to skip along water and detonate at the base of a dam.' },
        { keyword: 'fifth-generation', generatedDescription: 'A classification of fighter aircraft featuring stealth, sensor fusion, and advanced networked warfare capability.' },
      ],
      media: [pid],
      dateAdded: daysAgo(10),
    },

    // ── 1 × Tech ─────────────────────────────────────────────────────────────

    {
      category: 'Tech',
      title: 'E-7 Wedgetail — Next-Generation Airborne Early Warning & Control',
      subtitle: "The RAF's incoming AEW&C platform replacing the retired E-3D Sentry fleet",
      description: `The Boeing E-7 Wedgetail is the Royal Air Force's incoming Airborne Early Warning and Control System, selected to replace the ageing E-3D Sentry following the type's retirement in 2021. Based on the Boeing 737-700 airframe, the E-7 is equipped with the Multi-Role Electronically Scanned Array radar — a fixed dorsal antenna providing 360-degree coverage with significantly enhanced processing power and electronic counter-countermeasures resistance compared to the rotating rotodome on the E-3. The MESA radar can simultaneously track hundreds of targets while controlling multiple intercepts in contested electromagnetic environments. The RAF has committed to three aircraft, with initial deliveries expected to enter service with No. 8 Squadron at RAF Lossiemouth. The E-7 operates in close concert with the F-35B as the airborne node in a networked kill chain that fuses information from space, air, land, and maritime sensors. Australia's RAAF has operated the E-7 since 2009 with considerable operational success, providing the RAF with a mature development baseline.`,
      sources: [{ url: 'https://www.raf.mod.uk/aircraft/e-7-wedgetail/', siteName: 'RAF.mod.uk' }],
      keywords: [
        { keyword: 'AEW&C', generatedDescription: 'Airborne Early Warning and Control: an airborne radar platform that detects threats and provides command and control to friendly forces.' },
        { keyword: 'MESA radar', generatedDescription: 'Multi-Role Electronically Scanned Array: the fixed-array radar on the E-7 providing 360-degree air and surface surveillance.' },
        { keyword: 'kill chain', generatedDescription: 'The sequence — find, fix, track, target, engage, assess — used to identify and engage a target in modern warfare.' },
      ],
      media: [pid],
      dateAdded: daysAgo(11),
    },

  ];

  await IntelligenceBrief.insertMany(briefs);
  console.log('Seeded 10 dummy intel briefs');
}

module.exports = seedBriefs;
