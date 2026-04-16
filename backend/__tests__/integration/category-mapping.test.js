/**
 * Unit tests for category/subcategory mapping utilities.
 * No DB required — these are pure function tests.
 *
 * Covers:
 *   leadSectionToCategory   — all 14 sections + edge cases
 *   leadSubsectionToSubcategory — all known subsection headers
 */
process.env.JWT_SECRET = 'test_secret';

const { leadSectionToCategory, leadSubsectionToSubcategory } = require('../../utils/categoryMapping');
const { SUBCATEGORIES } = require('../../constants/categories');

// ── leadSectionToCategory ────────────────────────────────────────────────────

describe('leadSectionToCategory', () => {
  const cases = [
    ['SECTION 1: RAF RANKS',                                    'Ranks'],
    ['SECTION 2: RAF SQUADRONS',                                'Squadrons'],
    ['SECTION 3: RAF AIRCRAFT — CURRENT & RECENT',              'Aircrafts'],
    ['SECTION 4: RAF AIRCRAFT — HISTORICAL / LEGACY',           'Aircrafts'],
    ['SECTION 5: RAF BASES — UNITED KINGDOM',                   'Bases'],
    ['SECTION 6: RAF BASES — WORLDWIDE / OVERSEAS',             'Bases'],
    ['SECTION 7: TRAINING — RAF COURSES, PROGRAMMES & CONCEPTS','Training'],
    ['SECTION 8: THREATS — HISTORIC & CURRENT',                 'Threats'],
    ['SECTION 9: ALLIES & PARTNER NATIONS',                     'Allies'],
    ['SECTION 10: HISTORIC & ONGOING RAF OPERATIONS / MISSIONS','Missions'],
    ['SECTION 11: TECHNOLOGY — RAF & RELEVANT MILITARY AVIATION','Tech'],
    ['SECTION 12: RAF TERMINOLOGY & KEY CONCEPTS',              'Terminology'],
    ['SECTION 13: TREATIES & AGREEMENTS — RAF / UK DEFENCE RELEVANT', 'Treaties'],
    ['SECTION 14: AREAS OF RESPONSIBILITY (AOR)',               'AOR'],
  ];

  test.each(cases)('%s → %s', (section, expected) => {
    expect(leadSectionToCategory(section)).toBe(expected);
  });

  it('returns News (default) for empty section string', () => {
    expect(leadSectionToCategory('')).toBe('News');
  });

  it('returns News for an unrecognised section header', () => {
    expect(leadSectionToCategory('SOME RANDOM HEADER')).toBe('News');
  });

  // Regression: /SECTION 1/i would match SECTION 10-14, returning 'Ranks' instead of correct category
  it('does NOT map SECTION 10 to Ranks (regression)', () => {
    expect(leadSectionToCategory('SECTION 10: HISTORIC & ONGOING RAF OPERATIONS / MISSIONS')).not.toBe('Ranks');
  });

  it('does NOT map SECTION 11 to Ranks (regression)', () => {
    expect(leadSectionToCategory('SECTION 11: TECHNOLOGY — RAF & RELEVANT MILITARY AVIATION')).not.toBe('Ranks');
  });

  it('does NOT map SECTION 12 to Ranks (regression)', () => {
    expect(leadSectionToCategory('SECTION 12: RAF TERMINOLOGY & KEY CONCEPTS')).not.toBe('Ranks');
  });

  it('does NOT map SECTION 13 to Ranks (regression)', () => {
    expect(leadSectionToCategory('SECTION 13: TREATIES & AGREEMENTS')).not.toBe('Ranks');
  });

  it('does NOT map SECTION 14 to Ranks (regression)', () => {
    expect(leadSectionToCategory('SECTION 14: AREAS OF RESPONSIBILITY (AOR)')).not.toBe('Ranks');
  });
});

// ── leadSubsectionToSubcategory ──────────────────────────────────────────────

describe('leadSubsectionToSubcategory', () => {
  const cases = [
    // Aircrafts
    ['FAST JET',                                             'Fast Jet'],
    ['INTELLIGENCE, SURVEILLANCE & RECONNAISSANCE (ISR)',    'ISR & Surveillance'],
    ['MARITIME PATROL',                                      'Maritime Patrol'],
    ['TRANSPORT & TANKER',                                   'Transport & Tanker'],
    ['ROTARY WING',                                          'Rotary Wing'],
    ['TRAINING (FIXED WING)',                                'Training Aircraft'],
    ['GROUND-BASED AIR DEFENCE (RAF REGIMENT)',              'Ground-Based Air Defence'],
    ['WWII ERA',                                             'Historic — WWII'],
    ['PRE-WWII / INTERWAR',                                  'Historic — WWII'],
    ['COLD WAR ERA',                                         'Historic — Cold War'],
    ['PANAVIA TORNADO FAMILY',                               'Historic — Cold War'],
    ['BAE HARRIER FAMILY',                                   'Historic — Cold War'],
    ['POST-COLD WAR / RECENT RETIREMENTS',                   'Historic — Post-Cold War'],
    // Bases
    ['MAIN OPERATING BASES',                                 'UK Active'],
    ['SUPPORT, INTELLIGENCE & SPECIALIST SITES',             'UK Active'],
    ['FORMER / RECENTLY CLOSED UK BASES',                    'UK Former'],
    ['PERMANENT OVERSEAS BASES',                             'Overseas Permanent'],
    ['DEPLOYED / FORWARD OPERATING LOCATIONS',               'Overseas Deployed / FOL'],
    // Ranks
    ['COMMISSIONED OFFICER RANKS',                           'Commissioned Officer'],
    ['NON-COMMISSIONED RANKS',                               'Non-Commissioned'],
    ['SPECIALIST ROLES & DESIGNATIONS',                      'Specialist Role'],
    // Squadrons
    ['ACTIVE FRONT-LINE SQUADRONS',                          'Active Front-Line'],
    ['TRAINING SQUADRONS',                                   'Training'],
    ['ROYAL AUXILIARY AIR FORCE (RAuxAF) SQUADRONS',         'Royal Auxiliary Air Force'],
    ['HISTORIC / FAMOUS SQUADRONS',                          'Historic'],
    // Training
    ['INITIAL TRAINING',                                     'Initial Training'],
    ['FLYING TRAINING PIPELINE',                             'Flying Training'],
    ['GROUND TRAINING & PROFESSIONAL MILITARY EDUCATION',    'Ground Training & PME'],
    ['AIR COMBAT & TACTICAL TRAINING',                       'Tactical & Combat Training'],
    // Threats
    ['STATE ACTOR AIR THREATS',                              'State Actor Air'],
    ['SURFACE-TO-AIR MISSILE (SAM) THREATS',                'Surface-to-Air Missiles'],
    ['ASYMMETRIC / NON-STATE THREATS',                       'Asymmetric & Non-State'],
    ['MISSILE & STAND-OFF THREATS',                          'Missiles & Stand-Off'],
    ['ELECTRONIC & CYBER THREATS',                           'Electronic & Cyber'],
    // Allies
    ['NATO ALLIES (KEY)',                                     'NATO'],
    ['FIVE EYES PARTNERS',                                   'Five Eyes'],
    ['AUKUS PARTNERS',                                       'AUKUS'],
    ['BILATERAL & FRAMEWORK PARTNERS',                       'Bilateral & Framework Partners'],
    // Missions (previously unmapped — regression)
    ['WORLD WAR I',                                          'World War I'],
    ['WORLD WAR II',                                         'World War II'],
    ['POST-WAR / COLD WAR',                                  'Post-War & Cold War'],
    ['POST-COLD WAR',                                        'Post-Cold War'],
    ['WAR ON TERROR / 21ST CENTURY',                         'War on Terror'],
    ['NATO STANDING OPERATIONS',                             'NATO Standing Operations'],
    ['HUMANITARIAN / DISASTER RELIEF',                       'Humanitarian & NEO'],
    // Tech
    ['WEAPONS SYSTEMS',                                      'Weapons Systems'],
    ['SENSORS & AVIONICS',                                   'Sensors & Avionics'],
    ['ELECTRONIC WARFARE',                                   'Electronic Warfare'],
    ['FUTURE TECHNOLOGY & PROGRAMMES',                       'Future Programmes'],
    ['COMMAND & CONTROL / COMMS',                            'Command, Control & Comms'],
    // Terminology
    ['OPERATIONAL CONCEPTS',                                 'Operational Concepts'],
    ['FLYING & TACTICAL TERMINOLOGY',                        'Flying & Tactical'],
    ['AIR TRAFFIC & NAVIGATION',                             'Air Traffic & Navigation'],
    ['INTELLIGENCE & PLANNING',                              'Intelligence & Planning'],
    ['MAINTENANCE & SUPPORT',                                'Maintenance & Support'],
    // Treaties
    ['FOUNDING & CORE ALLIANCES',                            'Founding & Core Alliances'],
    ['BILATERAL DEFENCE AGREEMENTS',                         'Bilateral Defence Agreements'],
    ['ARMS CONTROL & NON-PROLIFERATION',                     'Arms Control & Non-Proliferation'],
    ['OPERATIONAL & STATUS AGREEMENTS',                      'Operational & Status Agreements'],
    ['DEFENCE POLICY & STRATEGY',                            'Defence Policy & Strategy'],
    // AOR (previously unmapped — regression)
    ['UK / HOME AIR DEFENCE',                                'UK Home Air Defence'],
    ['NATO AOR STRUCTURE',                                   'NATO AOR'],
    ['CENTCOM / MIDDLE EAST AOR',                            'Middle East & CENTCOM'],
    ['ATLANTIC / GIUK GAP',                                  'Atlantic & GIUK Gap'],
    ['AFRICA AOR',                                           'Africa'],
    ['INDO-PACIFIC AOR',                                     'Indo-Pacific'],
    ['FALKLAND ISLANDS AOR',                                 'South Atlantic & Falklands'],
  ];

  test.each(cases)('%s → %s', (subsection, expected) => {
    expect(leadSubsectionToSubcategory(subsection)).toBe(expected);
  });

  it('returns empty string for an unmapped subsection', () => {
    expect(leadSubsectionToSubcategory('AIR-SPECIFIC AGREEMENTS')).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(leadSubsectionToSubcategory('')).toBe('');
  });
});

// ── Coverage check: all model subcategories are reachable ────────────────────

describe('leadSubsectionToSubcategory — model coverage', () => {
  const categoriesToCheck = [
    'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
    'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
  ];

  for (const category of categoriesToCheck) {
    it(`every ${category} subcategory is reachable from the map`, () => {
      const subs = SUBCATEGORIES[category];
      const reachable = new Set(
        Object.values(
          // Re-use the same map logic by collecting all mapped values
          (() => {
            const map = {};
            const cases2 = [
              ['FAST JET', 'Fast Jet'],
              ['INTELLIGENCE, SURVEILLANCE & RECONNAISSANCE (ISR)', 'ISR & Surveillance'],
              ['MARITIME PATROL', 'Maritime Patrol'],
              ['TRANSPORT & TANKER', 'Transport & Tanker'],
              ['ROTARY WING', 'Rotary Wing'],
              ['TRAINING (FIXED WING)', 'Training Aircraft'],
              ['GROUND-BASED AIR DEFENCE (RAF REGIMENT)', 'Ground-Based Air Defence'],
              ['WWII ERA', 'Historic — WWII'],
              ['PRE-WWII / INTERWAR', 'Historic — WWII'],
              ['COLD WAR ERA', 'Historic — Cold War'],
              ['PANAVIA TORNADO FAMILY', 'Historic — Cold War'],
              ['BAE HARRIER FAMILY', 'Historic — Cold War'],
              ['POST-COLD WAR / RECENT RETIREMENTS', 'Historic — Post-Cold War'],
              ['MAIN OPERATING BASES', 'UK Active'],
              ['SUPPORT, INTELLIGENCE & SPECIALIST SITES', 'UK Active'],
              ['FORMER / RECENTLY CLOSED UK BASES', 'UK Former'],
              ['PERMANENT OVERSEAS BASES', 'Overseas Permanent'],
              ['DEPLOYED / FORWARD OPERATING LOCATIONS', 'Overseas Deployed / FOL'],
              ['COMMISSIONED OFFICER RANKS', 'Commissioned Officer'],
              ['NON-COMMISSIONED RANKS', 'Non-Commissioned'],
              ['SPECIALIST ROLES & DESIGNATIONS', 'Specialist Role'],
              ['ACTIVE FRONT-LINE SQUADRONS', 'Active Front-Line'],
              ['TRAINING SQUADRONS', 'Training'],
              ['ROYAL AUXILIARY AIR FORCE (RAuxAF) SQUADRONS', 'Royal Auxiliary Air Force'],
              ['HISTORIC / FAMOUS SQUADRONS', 'Historic'],
              ['INITIAL TRAINING', 'Initial Training'],
              ['FLYING TRAINING PIPELINE', 'Flying Training'],
              ['GROUND TRAINING & PROFESSIONAL MILITARY EDUCATION', 'Ground Training & PME'],
              ['AIR COMBAT & TACTICAL TRAINING', 'Tactical & Combat Training'],
              ['STATE ACTOR AIR THREATS', 'State Actor Air'],
              ['SURFACE-TO-AIR MISSILE (SAM) THREATS', 'Surface-to-Air Missiles'],
              ['ASYMMETRIC / NON-STATE THREATS', 'Asymmetric & Non-State'],
              ['MISSILE & STAND-OFF THREATS', 'Missiles & Stand-Off'],
              ['ELECTRONIC & CYBER THREATS', 'Electronic & Cyber'],
              ['NATO ALLIES (KEY)', 'NATO'],
              ['FIVE EYES PARTNERS', 'Five Eyes'],
              ['AUKUS PARTNERS', 'AUKUS'],
              ['BILATERAL & FRAMEWORK PARTNERS', 'Bilateral & Framework Partners'],
              ['WORLD WAR I', 'World War I'],
              ['WORLD WAR II', 'World War II'],
              ['POST-WAR / COLD WAR', 'Post-War & Cold War'],
              ['POST-COLD WAR', 'Post-Cold War'],
              ['WAR ON TERROR / 21ST CENTURY', 'War on Terror'],
              ['NATO STANDING OPERATIONS', 'NATO Standing Operations'],
              ['HUMANITARIAN / DISASTER RELIEF', 'Humanitarian & NEO'],
              ['WEAPONS SYSTEMS', 'Weapons Systems'],
              ['SENSORS & AVIONICS', 'Sensors & Avionics'],
              ['ELECTRONIC WARFARE', 'Electronic Warfare'],
              ['FUTURE TECHNOLOGY & PROGRAMMES', 'Future Programmes'],
              ['COMMAND & CONTROL / COMMS', 'Command, Control & Comms'],
              ['OPERATIONAL CONCEPTS', 'Operational Concepts'],
              ['FLYING & TACTICAL TERMINOLOGY', 'Flying & Tactical'],
              ['AIR TRAFFIC & NAVIGATION', 'Air Traffic & Navigation'],
              ['INTELLIGENCE & PLANNING', 'Intelligence & Planning'],
              ['MAINTENANCE & SUPPORT', 'Maintenance & Support'],
              ['FOUNDING & CORE ALLIANCES', 'Founding & Core Alliances'],
              ['BILATERAL DEFENCE AGREEMENTS', 'Bilateral Defence Agreements'],
              ['ARMS CONTROL & NON-PROLIFERATION', 'Arms Control & Non-Proliferation'],
              ['OPERATIONAL & STATUS AGREEMENTS', 'Operational & Status Agreements'],
              ['DEFENCE POLICY & STRATEGY', 'Defence Policy & Strategy'],
              ['UK / HOME AIR DEFENCE', 'UK Home Air Defence'],
              ['NATO AOR STRUCTURE', 'NATO AOR'],
              ['CENTCOM / MIDDLE EAST AOR', 'Middle East & CENTCOM'],
              ['ATLANTIC / GIUK GAP', 'Atlantic & GIUK Gap'],
              ['AFRICA AOR', 'Africa'],
              ['INDO-PACIFIC AOR', 'Indo-Pacific'],
              ['FALKLAND ISLANDS AOR', 'South Atlantic & Falklands'],
            ];
            cases2.forEach(([k, v]) => { map[k] = v; });
            return map;
          })()
        )
      );

      for (const sub of subs) {
        expect(reachable).toContain(sub);
      }
    });
  }
});
