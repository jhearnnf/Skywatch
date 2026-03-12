/**
 * Category/subcategory mapping utilities for intel_brief_leads.txt parsing.
 * These are the canonical tested versions — Admin.jsx mirrors this logic.
 */

const { CATEGORIES } = require('../models/IntelligenceBrief');

/**
 * Map a SECTION header string (e.g. "SECTION 10: HISTORIC & ONGOING RAF OPERATIONS")
 * to a brief category string.
 */
function leadSectionToCategory(section) {
  if (!section) return CATEGORIES[0];
  const match = section.match(/SECTION\s+(\d+)/i);
  const num = match ? parseInt(match[1], 10) : 0;
  const map = {
    1:  'Ranks',
    2:  'Squadrons',
    3:  'Aircrafts',
    4:  'Aircrafts',
    5:  'Bases',
    6:  'Bases',
    7:  'Training',
    8:  'Threats',
    9:  'Allies',
    10: 'Missions',
    11: 'Tech',
    12: 'Terminology',
    13: 'Treaties',
    14: 'AOR',
  };
  return map[num] ?? CATEGORIES[0];
}

/**
 * Map a subsection header string (e.g. "FAST JET" stripped of --- delimiters)
 * to a brief subcategory string. Returns '' for unrecognised headers.
 */
function leadSubsectionToSubcategory(subsection) {
  const map = {
    // Aircrafts — Section 3
    'FAST JET':                                            'Fast Jet',
    'INTELLIGENCE, SURVEILLANCE & RECONNAISSANCE (ISR)':  'ISR & Surveillance',
    'MARITIME PATROL':                                     'Maritime Patrol',
    'TRANSPORT & TANKER':                                  'Transport & Tanker',
    'ROTARY WING':                                         'Rotary Wing',
    'TRAINING (FIXED WING)':                               'Training Aircraft',
    'GROUND-BASED AIR DEFENCE (RAF REGIMENT)':             'Ground-Based Air Defence',
    // Aircrafts — Section 4 (historical)
    'WWII ERA':                                            'Historic — WWII',
    'PRE-WWII / INTERWAR':                                 'Historic — WWII',
    'COLD WAR ERA':                                        'Historic — Cold War',
    'PANAVIA TORNADO FAMILY':                              'Historic — Cold War',
    'BAE HARRIER FAMILY':                                  'Historic — Cold War',
    'POST-COLD WAR / RECENT RETIREMENTS':                  'Historic — Post-Cold War',
    // Bases — Sections 5 & 6
    'MAIN OPERATING BASES':                                'UK Active',
    'SUPPORT, INTELLIGENCE & SPECIALIST SITES':            'UK Active',
    'FORMER / RECENTLY CLOSED UK BASES':                   'UK Former',
    'PERMANENT OVERSEAS BASES':                            'Overseas Permanent',
    'DEPLOYED / FORWARD OPERATING LOCATIONS':              'Overseas Deployed / FOL',
    // Ranks — Section 1
    'COMMISSIONED OFFICER RANKS':                          'Commissioned Officer',
    'NON-COMMISSIONED RANKS':                              'Non-Commissioned',
    'SPECIALIST ROLES & DESIGNATIONS':                     'Specialist Role',
    // Squadrons — Section 2
    'ACTIVE FRONT-LINE SQUADRONS':                         'Active Front-Line',
    'TRAINING SQUADRONS':                                  'Training',
    'ROYAL AUXILIARY AIR FORCE (RAuxAF) SQUADRONS':        'Royal Auxiliary Air Force',
    'HISTORIC / FAMOUS SQUADRONS':                         'Historic',
    // Training — Section 7
    'INITIAL TRAINING':                                    'Initial Training',
    'FLYING TRAINING PIPELINE':                            'Flying Training',
    'GROUND TRAINING & PROFESSIONAL MILITARY EDUCATION':   'Ground Training & PME',
    'AIR COMBAT & TACTICAL TRAINING':                      'Tactical & Combat Training',
    // Threats — Section 8
    'STATE ACTOR AIR THREATS':                             'State Actor Air',
    'SURFACE-TO-AIR MISSILE (SAM) THREATS':               'Surface-to-Air Missiles',
    'ASYMMETRIC / NON-STATE THREATS':                      'Asymmetric & Non-State',
    'MISSILE & STAND-OFF THREATS':                         'Missiles & Stand-Off',
    'ELECTRONIC & CYBER THREATS':                          'Electronic & Cyber',
    // Allies — Section 9
    'NATO ALLIES (KEY)':                                   'NATO',
    'FIVE EYES PARTNERS':                                  'Five Eyes',
    'AUKUS PARTNERS':                                      'AUKUS',
    'BILATERAL & FRAMEWORK PARTNERS':                      'Bilateral & Framework Partners',
    // Missions — Section 10
    'WORLD WAR I':                                         'World War I',
    'WORLD WAR II':                                        'World War II',
    'POST-WAR / COLD WAR':                                 'Post-War & Cold War',
    'POST-COLD WAR':                                       'Post-Cold War',
    'WAR ON TERROR / 21ST CENTURY':                        'War on Terror',
    'NATO STANDING OPERATIONS':                            'NATO Standing Operations',
    'HUMANITARIAN / DISASTER RELIEF':                      'Humanitarian & NEO',
    // Tech — Section 11
    'WEAPONS SYSTEMS':                                     'Weapons Systems',
    'SENSORS & AVIONICS':                                  'Sensors & Avionics',
    'ELECTRONIC WARFARE':                                  'Electronic Warfare',
    'FUTURE TECHNOLOGY & PROGRAMMES':                      'Future Programmes',
    'COMMAND & CONTROL / COMMS':                           'Command, Control & Comms',
    // Terminology — Section 12
    'OPERATIONAL CONCEPTS':                                'Operational Concepts',
    'FLYING & TACTICAL TERMINOLOGY':                       'Flying & Tactical',
    'AIR TRAFFIC & NAVIGATION':                            'Air Traffic & Navigation',
    'INTELLIGENCE & PLANNING':                             'Intelligence & Planning',
    'MAINTENANCE & SUPPORT':                               'Maintenance & Support',
    // Treaties — Section 13
    'FOUNDING & CORE ALLIANCES':                           'Founding & Core Alliances',
    'BILATERAL DEFENCE AGREEMENTS':                        'Bilateral Defence Agreements',
    'ARMS CONTROL & NON-PROLIFERATION':                    'Arms Control & Non-Proliferation',
    'OPERATIONAL & STATUS AGREEMENTS':                     'Operational & Status Agreements',
    // AOR — Section 14
    'UK / HOME AIR DEFENCE':                               'UK Home Air Defence',
    'NATO AOR STRUCTURE':                                  'NATO AOR',
    'CENTCOM / MIDDLE EAST AOR':                           'Middle East & CENTCOM',
    'ATLANTIC / GIUK GAP':                                 'Atlantic & GIUK Gap',
    'AFRICA AOR':                                          'Africa',
    'INDO-PACIFIC AOR':                                    'Indo-Pacific',
    'FALKLAND ISLANDS AOR':                                'South Atlantic & Falklands',
  };
  return map[subsection] || '';
}

module.exports = { leadSectionToCategory, leadSubsectionToSubcategory };
