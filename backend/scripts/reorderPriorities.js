/**
 * reorderPriorities.js
 *
 * Bulk-updates the `priorityNumber` field for intel briefs that need reordering.
 * Run with: node backend/scripts/reorderPriorities.js
 *
 * Categories updated: AIRCRAFTS, BASES, MISSIONS, SQUADRONS, TECH, TERMINOLOGY, TRAINING
 * Categories left unchanged: AOR, Allies, Heritage, Ranks, Roles, Threats
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGODB_URI;

const COLLECTION = 'intelligencebriefs';

// ---------------------------------------------------------------------------
// Priority mappings — { category, title, priority }
// ---------------------------------------------------------------------------

const updates = [

  // =========================================================================
  // AIRCRAFTS — 82 entries, single sequential list
  // =========================================================================

  // --- Current Active Fleet (1–25) ---
  { category: 'Aircrafts', title: 'Eurofighter Typhoon FGR4',               priority: 1  },
  { category: 'Aircrafts', title: 'F-35B Lightning II',                      priority: 2  },
  { category: 'Aircrafts', title: 'Boeing E-7A Wedgetail',                   priority: 3  },
  { category: 'Aircrafts', title: 'Boeing P-8A Poseidon MRA1',               priority: 4  },
  { category: 'Aircrafts', title: 'Airbus A330 MRTT Voyager KC2/KC3',        priority: 5  },
  { category: 'Aircrafts', title: 'Airbus A400M Atlas C1',                   priority: 6  },
  { category: 'Aircrafts', title: 'Boeing C-17A Globemaster III',            priority: 7  },
  { category: 'Aircrafts', title: 'Boeing RC-135W Rivet Joint',              priority: 8  },
  { category: 'Aircrafts', title: 'Boeing Chinook HC6/6A',                   priority: 9  },
  { category: 'Aircrafts', title: 'Protector RG1',                           priority: 10 },
  { category: 'Aircrafts', title: 'Eurofighter Typhoon T3',                  priority: 11 },
  { category: 'Aircrafts', title: 'BAE Systems Hawk T2',                     priority: 12 },
  { category: 'Aircrafts', title: 'BAE Systems Hawk T1',                     priority: 13 },
  { category: 'Aircrafts', title: 'Grob G120TP Prefect T1',                  priority: 14 },
  { category: 'Aircrafts', title: 'Grob Tutor T1',                           priority: 15 },
  { category: 'Aircrafts', title: 'Beechcraft Shadow R1',                    priority: 16 },
  { category: 'Aircrafts', title: 'MQ-9A Reaper',                            priority: 17 },
  { category: 'Aircrafts', title: 'AgustaWestland AW109 Jupiter HT1',        priority: 18 },
  { category: 'Aircrafts', title: 'Airbus H135 Juno HT1',                    priority: 19 },
  { category: 'Aircrafts', title: 'Sikorsky Griffin HT1',                    priority: 20 },
  { category: 'Aircrafts', title: 'Airbus Puma HC2',                         priority: 21 },
  { category: 'Aircrafts', title: 'BAe 146 CC2/C3',                          priority: 22 },
  { category: 'Aircrafts', title: 'Beechcraft Avenger T1',                   priority: 23 },
  { category: 'Aircrafts', title: 'Sky Sabre / CAMM',                        priority: 24 },
  { category: 'Aircrafts', title: 'Starstreak HVM',                          priority: 25 },

  // --- Recently Retired (26–35) ---
  { category: 'Aircrafts', title: 'Lockheed C-130J Hercules C4/C5',          priority: 26 },
  { category: 'Aircrafts', title: 'Boeing E-3D Sentry AEW1',                 priority: 27 },
  { category: 'Aircrafts', title: 'Raytheon Sentinel R1',                    priority: 28 },
  { category: 'Aircrafts', title: 'Panavia Tornado GR4',                     priority: 29 },
  { category: 'Aircrafts', title: 'BAE Harrier GR7/9',                       priority: 30 },
  { category: 'Aircrafts', title: 'Panavia Tornado F3',                      priority: 31 },
  { category: 'Aircrafts', title: 'Hawker Siddeley Dominie T1',              priority: 32 },
  { category: 'Aircrafts', title: 'Rapier FSC',                              priority: 33 },
  { category: 'Aircrafts', title: 'Shorts Tucano T1',                        priority: 34 },
  { category: 'Aircrafts', title: 'Lockheed Hercules C-130K',                priority: 35 },

  // --- Iconic Heritage — culturally significant (36–41) ---
  { category: 'Aircrafts', title: 'Supermarine Spitfire',                    priority: 36 },
  { category: 'Aircrafts', title: 'Hawker Hurricane',                        priority: 37 },
  { category: 'Aircrafts', title: 'Avro Lancaster B.I',                      priority: 38 },
  { category: 'Aircrafts', title: 'de Havilland Mosquito',                   priority: 39 },
  { category: 'Aircrafts', title: 'Avro Vulcan B2',                          priority: 40 },
  { category: 'Aircrafts', title: 'BAC Lightning F6',                        priority: 41 },

  // --- Cold War Era (42–59) ---
  { category: 'Aircrafts', title: 'Hawker Siddeley Buccaneer S2B',           priority: 42 },
  { category: 'Aircrafts', title: 'Hawker Siddeley Nimrod MR2',              priority: 43 },
  { category: 'Aircrafts', title: 'SEPECAT Jaguar GR3A',                     priority: 44 },
  { category: 'Aircrafts', title: 'Handley Page Victor K2',                  priority: 45 },
  { category: 'Aircrafts', title: 'Panavia Tornado GR1',                     priority: 46 },
  { category: 'Aircrafts', title: 'Hawker Siddeley Harrier GR1',             priority: 47 },
  { category: 'Aircrafts', title: 'BAC VC10 K3/K4',                         priority: 48 },
  { category: 'Aircrafts', title: 'Lockheed Tristar K1/C2',                  priority: 49 },
  { category: 'Aircrafts', title: 'English Electric Canberra PR9',           priority: 50 },
  { category: 'Aircrafts', title: 'Hawker Hunter F6',                        priority: 51 },
  { category: 'Aircrafts', title: 'Gloster Meteor F8',                       priority: 52 },
  { category: 'Aircrafts', title: 'Gloster Javelin',                         priority: 53 },
  { category: 'Aircrafts', title: 'Vickers Valiant',                         priority: 54 },
  { category: 'Aircrafts', title: 'Bristol Bloodhound',                      priority: 55 },
  { category: 'Aircrafts', title: 'de Havilland Vampire FB5',                priority: 56 },
  { category: 'Aircrafts', title: 'de Havilland Venom FB4',                  priority: 57 },
  { category: 'Aircrafts', title: 'BAC TSR-2',                               priority: 58 },
  { category: 'Aircrafts', title: 'Hawker Siddeley Nimrod MRA4',             priority: 59 },

  // --- WWII Era (60–82) ---
  { category: 'Aircrafts', title: 'Vickers Wellington',                      priority: 60 },
  { category: 'Aircrafts', title: 'Handley Page Halifax B.III',              priority: 61 },
  { category: 'Aircrafts', title: 'Short Stirling B.III',                    priority: 62 },
  { category: 'Aircrafts', title: 'Avro Manchester',                         priority: 63 },
  { category: 'Aircrafts', title: 'Handley Page Hampden',                    priority: 64 },
  { category: 'Aircrafts', title: 'Armstrong Whitworth Whitley',             priority: 65 },
  { category: 'Aircrafts', title: 'Bristol Beaufighter TF.X',                priority: 66 },
  { category: 'Aircrafts', title: 'Bristol Blenheim IV',                     priority: 67 },
  { category: 'Aircrafts', title: 'Hawker Typhoon IB',                       priority: 68 },
  { category: 'Aircrafts', title: 'Hawker Tempest V',                        priority: 69 },
  { category: 'Aircrafts', title: 'North American Mustang',                  priority: 70 },
  { category: 'Aircrafts', title: 'de Havilland Hornet F3',                  priority: 71 },
  { category: 'Aircrafts', title: 'Hawker Fury',                             priority: 72 },
  { category: 'Aircrafts', title: 'Gloster Gladiator',                       priority: 73 },
  { category: 'Aircrafts', title: 'Bristol Bulldog',                         priority: 74 },
  { category: 'Aircrafts', title: 'Handley Page Heyford',                    priority: 75 },
  { category: 'Aircrafts', title: 'Avro Anson',                              priority: 76 },
  { category: 'Aircrafts', title: 'Supermarine Walrus',                      priority: 77 },
  { category: 'Aircrafts', title: 'Hawker Audax',                            priority: 78 },
  { category: 'Aircrafts', title: 'North American Harvard',                  priority: 79 },
  { category: 'Aircrafts', title: 'de Havilland Tiger Moth',                 priority: 80 },
  { category: 'Aircrafts', title: 'Airspeed Oxford',                         priority: 81 },
  { category: 'Aircrafts', title: 'Westland Whirlwind',                      priority: 82 },

  // =========================================================================
  // BASES — 79 entries, single sequential list
  // =========================================================================

  // --- Active UK Stations (1–32) ---
  { category: 'Bases', title: 'RAF Lossiemouth',                             priority: 1  },
  { category: 'Bases', title: 'RAF Coningsby',                               priority: 2  },
  { category: 'Bases', title: 'RAF Marham',                                  priority: 3  },
  { category: 'Bases', title: 'RAF Brize Norton',                            priority: 4  },
  { category: 'Bases', title: 'RAF Waddington',                              priority: 5  },
  { category: 'Bases', title: 'RAF Odiham',                                  priority: 6  },
  { category: 'Bases', title: 'RAF Valley',                                  priority: 7  },
  { category: 'Bases', title: 'RAF Cranwell',                                priority: 8  },
  { category: 'Bases', title: 'RAF High Wycombe',                            priority: 9  },
  { category: 'Bases', title: 'RAF Akrotiri',                                priority: 10 },
  { category: 'Bases', title: 'RAF Mount Pleasant',                          priority: 11 },
  { category: 'Bases', title: 'RAF Boulmer',                                 priority: 12 },
  { category: 'Bases', title: 'RAF Fylingdales',                             priority: 13 },
  { category: 'Bases', title: 'RAF Honington',                               priority: 14 },
  { category: 'Bases', title: 'RAF Cosford',                                 priority: 15 },
  { category: 'Bases', title: 'RAF Shawbury',                                priority: 16 },
  { category: 'Bases', title: 'RAF Northolt',                                priority: 17 },
  { category: 'Bases', title: 'RAF Benson',                                  priority: 18 },
  { category: 'Bases', title: 'RAF Leeming',                                 priority: 19 },
  { category: 'Bases', title: 'RAF Halton',                                  priority: 20 },
  { category: 'Bases', title: 'RAF Wittering',                               priority: 21 },
  { category: 'Bases', title: 'RAF Boscombe Down',                           priority: 22 },
  { category: 'Bases', title: 'RAF Digby',                                   priority: 23 },
  { category: 'Bases', title: 'RAF Menwith Hill',                            priority: 24 },
  { category: 'Bases', title: 'RAF Spadeadam',                               priority: 25 },
  { category: 'Bases', title: 'RAF Syerston',                                priority: 26 },
  { category: 'Bases', title: 'RAF Oakhanger',                               priority: 27 },
  { category: 'Bases', title: 'RAF West Freugh',                             priority: 28 },
  { category: 'Bases', title: 'MoD St Athan',                                priority: 29 },
  { category: 'Bases', title: 'RAF Dhekelia',                                priority: 30 },
  { category: 'Bases', title: 'RAF Gibraltar',                               priority: 31 },
  { category: 'Bases', title: 'RAF Ascension Island',                        priority: 32 },

  // --- Active Overseas / Forward Locations (33–45) ---
  { category: 'Bases', title: 'Al Udeid Air Base',                           priority: 33 },
  { category: 'Bases', title: 'Gioia del Colle',                             priority: 34 },
  { category: 'Bases', title: 'Mihail Kogalniceanu',                         priority: 35 },
  { category: 'Bases', title: 'Ämari Air Base',                              priority: 36 },
  { category: 'Bases', title: 'Šiauliai Air Base',                           priority: 37 },
  { category: 'Bases', title: 'Keflavik',                                    priority: 38 },
  { category: 'Bases', title: 'Ali Al Salem Air Base',                       priority: 39 },
  { category: 'Bases', title: 'Al Minhad Air Base',                          priority: 40 },
  { category: 'Bases', title: 'Muwaffaq Salti Air Base',                     priority: 41 },
  { category: 'Bases', title: 'Decimomannu',                                 priority: 42 },
  { category: 'Bases', title: 'RAF Fairford',                                priority: 43 },
  { category: 'Bases', title: 'Camp Lemonnier',                              priority: 44 },
  { category: 'Bases', title: 'Seeb and Thumrait Air Bases',                 priority: 45 },

  // --- Recently Closed UK Stations (46–58) ---
  { category: 'Bases', title: 'RAF Scampton',                                priority: 46 },
  { category: 'Bases', title: 'RAF Leuchars',                                priority: 47 },
  { category: 'Bases', title: 'RAF Lyneham',                                 priority: 48 },
  { category: 'Bases', title: 'RAF Kinloss',                                 priority: 49 },
  { category: 'Bases', title: 'RAF Linton-on-Ouse',                          priority: 50 },
  { category: 'Bases', title: 'RAF Henlow',                                  priority: 51 },
  { category: 'Bases', title: 'RAF Woodvale',                                priority: 52 },
  { category: 'Bases', title: 'RAF Pembrey Sands',                           priority: 53 },
  { category: 'Bases', title: 'RAF Chivenor',                                priority: 54 },
  { category: 'Bases', title: 'RAF Cottesmore',                              priority: 55 },
  { category: 'Bases', title: 'RAF St Mawgan',                               priority: 56 },
  { category: 'Bases', title: 'RAF Abingdon',                                priority: 57 },
  { category: 'Bases', title: 'RAF Binbrook',                                priority: 58 },

  // --- Cold War Germany (59–63) ---
  { category: 'Bases', title: 'RAF Brüggen',                                 priority: 59 },
  { category: 'Bases', title: 'RAF Laarbruch',                               priority: 60 },
  { category: 'Bases', title: 'RAF Gütersloh',                               priority: 61 },
  { category: 'Bases', title: 'RAF Wildenrath',                              priority: 62 },
  { category: 'Bases', title: 'RAF Rheindahlen',                             priority: 63 },

  // --- Historic Overseas — Cold War era (64–73) ---
  { category: 'Bases', title: 'RAF Nicosia',                                 priority: 64 },
  { category: 'Bases', title: 'RAF Sharjah',                                 priority: 65 },
  { category: 'Bases', title: 'RAF Muharraq',                                priority: 66 },
  { category: 'Bases', title: 'RAF Belize',                                  priority: 67 },
  { category: 'Bases', title: 'RAF El Adem',                                 priority: 68 },
  { category: 'Bases', title: 'RAF Luqa',                                    priority: 69 },
  { category: 'Bases', title: 'RAF Masirah',                                 priority: 70 },
  { category: 'Bases', title: 'RAF Nairobi / Eastleigh',                     priority: 71 },
  { category: 'Bases', title: 'RAF Upwood',                                  priority: 72 },
  { category: 'Bases', title: 'RAF Watton',                                  priority: 73 },

  // --- Historic Overseas — Far East / Colonial (74–79) ---
  { category: 'Bases', title: 'RAF Butterworth',                             priority: 74 },
  { category: 'Bases', title: 'RAF Tengah',                                  priority: 75 },
  { category: 'Bases', title: 'RAF Hong Kong',                               priority: 76 },
  { category: 'Bases', title: 'RAF Gan',                                     priority: 77 },
  { category: 'Bases', title: 'RAF Khormaksar',                              priority: 78 },
  { category: 'Bases', title: 'RAF Habbaniyah',                              priority: 79 },

  // =========================================================================
  // MISSIONS — 70 entries
  // =========================================================================

  // --- Current / Ongoing Operations (1–15) ---
  { category: 'Missions', title: 'Operation SHADER',                         priority: 1  },
  { category: 'Missions', title: 'NATO Baltic Air Policing',                 priority: 2  },
  { category: 'Missions', title: 'NATO Icelandic Air Policing',              priority: 3  },
  { category: 'Missions', title: 'Operation AZALEA',                        priority: 4  },
  { category: 'Missions', title: 'Operation CABRIT',                        priority: 5  },
  { category: 'Missions', title: 'Operation KIPION',                        priority: 6  },
  { category: 'Missions', title: 'NATO Enhanced Forward Presence',          priority: 7  },
  { category: 'Missions', title: 'Operation TOSCA',                         priority: 8  },
  { category: 'Missions', title: 'Operation DEFERENCE',                     priority: 9  },
  { category: 'Missions', title: 'UK Space Command',                        priority: 10 },
  { category: 'Missions', title: 'Air Command',                             priority: 11 },
  { category: 'Missions', title: 'Operation EPIC FURY',                     priority: 12 },
  { category: 'Missions', title: 'Operation BILOXI',                        priority: 13 },
  { category: 'Missions', title: 'Operation PELEGRI',                       priority: 14 },
  { category: 'Missions', title: 'Military Aid to Civil Authorities',       priority: 15 },

  // --- Recent Operations 2001–Present (16–42) ---
  { category: 'Missions', title: 'Operation PITTING',                       priority: 16 },
  { category: 'Missions', title: 'Operation HERRICK',                       priority: 17 },
  { category: 'Missions', title: 'Operation TELIC',                         priority: 18 },
  { category: 'Missions', title: 'Operation ELLAMY',                        priority: 19 },
  { category: 'Missions', title: 'Operation GRANBY',                        priority: 20 },
  { category: 'Missions', title: 'Falklands War',                           priority: 21 },
  { category: 'Missions', title: 'Operation CORPORATE',                     priority: 22 },
  { category: 'Missions', title: 'Operation BLACK BUCK',                    priority: 23 },
  { category: 'Missions', title: 'Gulf War',                                priority: 24 },
  { category: 'Missions', title: 'Operation ALLIED FORCE',                  priority: 25 },
  { category: 'Missions', title: 'Operation DELIBERATE FORCE',              priority: 26 },
  { category: 'Missions', title: 'Operation DENY FLIGHT',                   priority: 27 },
  { category: 'Missions', title: 'Operation WARDEN',                        priority: 28 },
  { category: 'Missions', title: 'Operation JURAL',                         priority: 29 },
  { category: 'Missions', title: 'Operation RESINATE',                      priority: 30 },
  { category: 'Missions', title: 'Operation PALLISER',                      priority: 31 },
  { category: 'Missions', title: 'Operation FINGAL',                        priority: 32 },
  { category: 'Missions', title: 'Operation FORTIFY',                       priority: 33 },
  { category: 'Missions', title: 'Operation PATWIN',                        priority: 34 },
  { category: 'Missions', title: 'Operation GOLDEN ORB',                    priority: 35 },
  { category: 'Missions', title: 'Operation PEAL',                          priority: 36 },
  { category: 'Missions', title: 'Operation SHADER Phases',                 priority: 37 },
  { category: 'Missions', title: 'Operation TELIC Sub-Operations',          priority: 38 },
  { category: 'Missions', title: 'Operation GRITROCK',                      priority: 39 },
  { category: 'Missions', title: 'Operation NEWCOMBE',                      priority: 40 },
  { category: 'Missions', title: 'COVID-19 medical logistics operations',   priority: 41 },
  { category: 'Missions', title: 'Caribbean hurricane relief operations',   priority: 42 },

  // --- Cold War / Post-War Operations (43–49) ---
  { category: 'Missions', title: 'Berlin Airlift',                          priority: 43 },
  { category: 'Missions', title: 'Dhofar Campaign',                         priority: 44 },
  { category: 'Missions', title: 'Indonesian Confrontation',                priority: 45 },
  { category: 'Missions', title: 'Korean War',                              priority: 46 },
  { category: 'Missions', title: 'Malayan Emergency',                       priority: 47 },
  { category: 'Missions', title: 'Suez Crisis',                             priority: 48 },
  { category: 'Missions', title: 'Aden / South Arabia',                     priority: 49 },

  // --- WWII Operations (50–67) ---
  { category: 'Missions', title: 'Battle of Britain',                       priority: 50 },
  { category: 'Missions', title: 'Operation CHASTISE',                      priority: 51 },
  { category: 'Missions', title: 'Bomber Command Strategic Campaign 1939–1945', priority: 52 },
  { category: 'Missions', title: 'Operation OVERLORD',                      priority: 53 },
  { category: 'Missions', title: 'Battle of the Atlantic',                  priority: 54 },
  { category: 'Missions', title: 'The Blitz Defence',                       priority: 55 },
  { category: 'Missions', title: 'Desert Air Force',                        priority: 56 },
  { category: 'Missions', title: 'Malta Air Defence',                       priority: 57 },
  { category: 'Missions', title: 'Pathfinder Force',                        priority: 58 },
  { category: 'Missions', title: 'No. 100 Group RAF',                       priority: 59 },
  { category: 'Missions', title: 'Far East Air Force Burma Campaign',       priority: 60 },
  { category: 'Missions', title: 'Operation MARKET GARDEN',                 priority: 61 },
  { category: 'Missions', title: 'Operation MANNA',                         priority: 62 },
  { category: 'Missions', title: 'Operation EXODUS',                        priority: 63 },
  { category: 'Missions', title: 'Operation BITING',                        priority: 64 },
  { category: 'Missions', title: 'Operation JERICHO',                       priority: 65 },
  { category: 'Missions', title: 'Operation CARTHAGE',                      priority: 66 },
  { category: 'Missions', title: 'Operation CROSSBOW',                      priority: 67 },

  // --- WWI / Formation (68–70) ---
  { category: 'Missions', title: 'RAF Formation 1 April 1918',              priority: 68 },
  { category: 'Missions', title: 'Battle of Cambrai',                       priority: 69 },
  { category: 'Missions', title: 'Royal Flying Corps',                      priority: 70 },

  // =========================================================================
  // SQUADRONS — 86 entries, single sequential list
  // =========================================================================

  // --- Famous / High-Profile Active Squadrons (1–20) ---
  { category: 'Squadrons', title: 'No. 617 Squadron RAF',                   priority: 1  },
  { category: 'Squadrons', title: 'Red Arrows',                             priority: 2  },
  { category: 'Squadrons', title: 'No. 1 Squadron RAF',                     priority: 3  },
  { category: 'Squadrons', title: 'No. 3 Squadron RAF',                     priority: 4  },
  { category: 'Squadrons', title: 'No. 6 Squadron RAF',                     priority: 5  },
  { category: 'Squadrons', title: 'No. 9 Squadron RAF',                     priority: 6  },
  { category: 'Squadrons', title: 'No. 11 Squadron RAF',                    priority: 7  },
  { category: 'Squadrons', title: 'No. 12 Squadron RAF',                    priority: 8  },
  { category: 'Squadrons', title: 'No. 2 Squadron RAF',                     priority: 9  },
  { category: 'Squadrons', title: 'No. 120 Squadron RAF',                   priority: 10 },
  { category: 'Squadrons', title: 'No. 8 Squadron RAF',                     priority: 11 },
  { category: 'Squadrons', title: 'No. 18 Squadron RAF',                    priority: 12 },
  { category: 'Squadrons', title: 'No. 27 Squadron RAF',                    priority: 13 },
  { category: 'Squadrons', title: 'No. 10 Squadron RAF',                    priority: 14 },
  { category: 'Squadrons', title: 'No. 101 Squadron RAF',                   priority: 15 },
  { category: 'Squadrons', title: 'No. 99 Squadron RAF',                    priority: 16 },
  { category: 'Squadrons', title: 'No. 47 Squadron RAF',                    priority: 17 },
  { category: 'Squadrons', title: 'No. 51 Squadron RAF',                    priority: 18 },
  { category: 'Squadrons', title: 'No. 201 Squadron RAF',                   priority: 19 },
  { category: 'Squadrons', title: 'No. 4 Squadron RAF',                     priority: 20 },

  // --- Other Active Numbered Squadrons (21–49) ---
  { category: 'Squadrons', title: 'No. 7 Squadron RAF',                     priority: 21 },
  { category: 'Squadrons', title: 'No. 17 Squadron RAF',                    priority: 22 },
  { category: 'Squadrons', title: 'No. 33 Squadron RAF',                    priority: 23 },
  { category: 'Squadrons', title: 'No. 24 Squadron RAF',                    priority: 24 },
  { category: 'Squadrons', title: 'No. 29 Squadron RAF',                    priority: 25 },
  { category: 'Squadrons', title: 'No. 31 Squadron RAF',                    priority: 26 },
  { category: 'Squadrons', title: 'No. 5 Squadron RAF',                     priority: 27 },
  { category: 'Squadrons', title: 'No. 14 Squadron RAF',                    priority: 28 },
  { category: 'Squadrons', title: 'No. 13 Squadron RAF',                    priority: 29 },
  { category: 'Squadrons', title: 'No. 39 Squadron RAF',                    priority: 30 },
  { category: 'Squadrons', title: 'No. 41 Squadron RAF',                    priority: 31 },
  { category: 'Squadrons', title: 'No. 32 Squadron RAF',                    priority: 32 },
  { category: 'Squadrons', title: 'No. 25 Squadron RAF',                    priority: 33 },
  { category: 'Squadrons', title: 'No. 28 Squadron RAF',                    priority: 34 },
  { category: 'Squadrons', title: 'No. 30 Squadron RAF',                    priority: 35 },
  { category: 'Squadrons', title: 'No. 16 Squadron RAF',                    priority: 36 },
  { category: 'Squadrons', title: 'No. 20 Squadron RAF',                    priority: 37 },
  { category: 'Squadrons', title: 'No. 84 Squadron RAF',                    priority: 38 },
  { category: 'Squadrons', title: 'No. 78 Squadron RAF',                    priority: 39 },
  { category: 'Squadrons', title: 'No. 230 Squadron RAF',                   priority: 40 },
  { category: 'Squadrons', title: 'No. 216 Squadron RAF',                   priority: 41 },
  { category: 'Squadrons', title: 'No. 60 Squadron RAF',                    priority: 42 },
  { category: 'Squadrons', title: 'No. 100 Squadron RAF',                   priority: 43 },
  { category: 'Squadrons', title: 'No. 70 Squadron RAF',                    priority: 44 },
  { category: 'Squadrons', title: 'No. 45 Squadron RAF',                    priority: 45 },
  { category: 'Squadrons', title: 'No. 54 Squadron RAF',                    priority: 46 },
  { category: 'Squadrons', title: 'No. 56 Squadron RAF',                    priority: 47 },
  { category: 'Squadrons', title: 'No. 57 Squadron RAF',                    priority: 48 },
  { category: 'Squadrons', title: 'No. 72 Squadron RAF',                    priority: 49 },

  // --- Space Squadrons (50–51) ---
  { category: 'Squadrons', title: 'No. 1 Space Operations Squadron',        priority: 50 },
  { category: 'Squadrons', title: 'No. 2 Space Warning Squadron',           priority: 51 },

  // --- Joint / Naval (52) ---
  { category: 'Squadrons', title: 'No. 809 Naval Air Squadron',             priority: 52 },

  // --- Heritage / Display (53–64) ---
  { category: 'Squadrons', title: 'Battle of Britain Memorial Flight',      priority: 53 },
  { category: 'Squadrons', title: 'No. 303 Squadron',                       priority: 54 },
  { category: 'Squadrons', title: 'Eagle Squadrons',                        priority: 55 },
  { category: 'Squadrons', title: 'No. 92 Squadron RAF',                    priority: 56 },
  { category: 'Squadrons', title: 'No. 74 Squadron RAF',                    priority: 57 },
  { category: 'Squadrons', title: 'No. 1 PRU',                              priority: 58 },
  { category: 'Squadrons', title: 'No. 100 Group RAF',                      priority: 59 },
  { category: 'Squadrons', title: 'No. 115 Squadron RAF',                   priority: 60 },
  { category: 'Squadrons', title: 'No. 202 Squadron RAF',                   priority: 61 },
  { category: 'Squadrons', title: 'No. 207 Squadron RAF',                   priority: 62 },

  // --- Groups / Commands (63–64) ---
  { category: 'Squadrons', title: 'No. 1 Group RAF',                        priority: 63 },
  { category: 'Squadrons', title: 'No. 38 Group RAF',                       priority: 64 },

  // --- RAF Regiment (65–74) ---
  { category: 'Squadrons', title: 'No. 1 Squadron RAF Regiment',            priority: 65 },
  { category: 'Squadrons', title: 'No. 2 Squadron RAF Regiment',            priority: 66 },
  { category: 'Squadrons', title: 'No. 15 Squadron RAF Regiment',           priority: 67 },
  { category: 'Squadrons', title: 'No. 16 Squadron RAF Regiment',           priority: 68 },
  { category: 'Squadrons', title: 'No. 26 Squadron RAF Regiment',           priority: 69 },
  { category: 'Squadrons', title: 'No. 27 Squadron RAF Regiment',           priority: 70 },
  { category: 'Squadrons', title: 'No. 34 Squadron RAF Regiment',           priority: 71 },
  { category: 'Squadrons', title: 'No. 35 Squadron RAF Regiment',           priority: 72 },
  { category: 'Squadrons', title: 'No. 51 Squadron RAF Regiment',           priority: 73 },
  { category: 'Squadrons', title: 'No. 63 Squadron RAF Regiment',           priority: 74 },

  // --- Flying Training (75–79) ---
  { category: 'Squadrons', title: 'Central Flying School',                  priority: 75 },
  { category: 'Squadrons', title: 'No. 4 Flying Training School',           priority: 76 },
  { category: 'Squadrons', title: 'No. 6 Flying Training School',           priority: 77 },
  { category: 'Squadrons', title: 'No. 22 Elementary Flying Training Squadron', priority: 78 },
  { category: 'Squadrons', title: 'Air Cadet Flying Organisation',          priority: 79 },

  // --- Royal Auxiliary Air Force (80–85) ---
  { category: 'Squadrons', title: 'No. 501 Squadron RAuxAF',                priority: 80 },
  { category: 'Squadrons', title: 'No. 502 Squadron RAuxAF',                priority: 81 },
  { category: 'Squadrons', title: 'No. 504 Squadron RAuxAF',                priority: 82 },
  { category: 'Squadrons', title: 'No. 600 Squadron RAuxAF',                priority: 83 },
  { category: 'Squadrons', title: 'No. 602 Squadron RAuxAF',                priority: 84 },
  { category: 'Squadrons', title: 'No. 603 Squadron RAuxAF',                priority: 85 },

  // =========================================================================
  // TECH — 59+ entries
  // =========================================================================

  // --- Weapons in Service (1–13) ---
  { category: 'Tech', title: 'Paveway IV',                                  priority: 1  },
  { category: 'Tech', title: 'MBDA Meteor BVRAAM',                          priority: 2  },
  { category: 'Tech', title: 'Brimstone 2/3',                               priority: 3  },
  { category: 'Tech', title: 'ASRAAM / AIM-132',                            priority: 4  },
  { category: 'Tech', title: 'Storm Shadow / SCALP-EG',                     priority: 5  },
  { category: 'Tech', title: 'AIM-120 AMRAAM',                              priority: 6  },
  { category: 'Tech', title: 'AIM-9X Sidewinder',                           priority: 7  },
  { category: 'Tech', title: 'SPEAR 3 / MBDA SPEAR',                        priority: 8  },
  { category: 'Tech', title: 'Stingray torpedo',                            priority: 9  },
  { category: 'Tech', title: 'Harpoon anti-ship missile',                   priority: 10 },
  { category: 'Tech', title: 'SPEAR-EW',                                    priority: 11 },
  { category: 'Tech', title: 'Joint Strike Missile',                        priority: 12 },
  { category: 'Tech', title: 'FC/ASW Future Cruise Anti-Ship Weapon',       priority: 13 },

  // --- Sensors & Avionics (14–25) ---
  { category: 'Tech', title: 'AN/APG-81 AESA Radar',                        priority: 14 },
  { category: 'Tech', title: 'AN/AAQ-40 EOTS',                              priority: 15 },
  { category: 'Tech', title: 'AN/AAQ-37 DAS',                               priority: 16 },
  { category: 'Tech', title: 'Striker II Helmet Mounted Display',           priority: 17 },
  { category: 'Tech', title: 'Typhoon HMD Mk3',                             priority: 18 },
  { category: 'Tech', title: 'LITENING III/IV Targeting Pod',               priority: 19 },
  { category: 'Tech', title: 'AN/AAQ-33 Sniper ATP',                        priority: 20 },
  { category: 'Tech', title: 'Praetorian DASS',                             priority: 21 },
  { category: 'Tech', title: 'BriteCloud Expendable Active Decoy',          priority: 22 },
  { category: 'Tech', title: 'Chaff and Flare dispensing systems',          priority: 23 },
  { category: 'Tech', title: 'Radar Warning Receivers',                     priority: 24 },
  { category: 'Tech', title: 'Directed Infrared Countermeasures',           priority: 25 },

  // --- ISR Platform Systems (26–29) ---
  { category: 'Tech', title: 'E-7A Wedgetail MESA radar',                   priority: 26 },
  { category: 'Tech', title: 'Shadow R1 sensor suite',                      priority: 27 },
  { category: 'Tech', title: 'RC-135W Rivet Joint SIGINT systems',          priority: 28 },
  { category: 'Tech', title: 'P-8A Poseidon acoustic sensors',              priority: 29 },

  // --- Comms & C2 (30–37) ---
  { category: 'Tech', title: 'Link 16 Tactical Data Link',                  priority: 30 },
  { category: 'Tech', title: 'SATURN Radio',                                priority: 31 },
  { category: 'Tech', title: 'Federated Mission Networking',                priority: 32 },
  { category: 'Tech', title: 'COMSEC and Crypto Systems',                   priority: 33 },
  { category: 'Tech', title: 'BOWMAN Tactical Comms',                       priority: 34 },
  { category: 'Tech', title: 'SKYNET 5/6',                                  priority: 35 },
  { category: 'Tech', title: 'NATO ACCS',                                   priority: 36 },
  { category: 'Tech', title: 'ISTAR fusion at RAF Waddington',              priority: 37 },

  // --- Future Programmes (38–56) ---
  { category: 'Tech', title: 'GCAP / Global Combat Air Programme',          priority: 38 },
  { category: 'Tech', title: 'F-35B Block 4 upgrade',                       priority: 39 },
  { category: 'Tech', title: 'ECRS Mk2 Radar',                              priority: 40 },
  { category: 'Tech', title: 'Autonomous Collaborative Platforms',          priority: 41 },
  { category: 'Tech', title: 'MBDA Complex Weapons Portfolio',              priority: 42 },
  { category: 'Tech', title: 'Counter-UAS Systems',                         priority: 43 },
  { category: 'Tech', title: 'Dragonfire directed energy laser weapon',     priority: 44 },
  { category: 'Tech', title: 'Dragonfire Directed Energy Weapon',           priority: 45 },
  { category: 'Tech', title: 'LANCA Loyal Wingman',                         priority: 46 },
  { category: 'Tech', title: 'Tempest demonstrator',                        priority: 47 },
  { category: 'Tech', title: 'Air-Launched Effects',                        priority: 48 },
  { category: 'Tech', title: 'Morpheus',                                    priority: 49 },
  { category: 'Tech', title: 'MORPHEUS Future Tactical Comms',              priority: 50 },
  { category: 'Tech', title: 'RAF Spadeadam EWTR',                          priority: 51 },
  { category: 'Tech', title: 'AI-assisted mission planning',                priority: 52 },
  { category: 'Tech', title: 'MALE RPAS Requirement',                       priority: 53 },
  { category: 'Tech', title: 'Kingspad ACMI Range',                         priority: 54 },
  { category: 'Tech', title: 'Quantum Key Distribution',                    priority: 55 },
  { category: 'Tech', title: 'Software-Defined Radar',                      priority: 56 },

  // --- Historic / Retired Systems (57–61) ---
  { category: 'Tech', title: 'ALARM Anti-Radiation Missile',                priority: 57 },
  { category: 'Tech', title: 'Sea Eagle Anti-Ship Missile',                 priority: 58 },
  { category: 'Tech', title: 'Enhanced Paveway II/III',                     priority: 59 },
  { category: 'Tech', title: 'WE.177 Nuclear Bomb',                         priority: 60 },
  { category: 'Tech', title: 'Blue Steel Stand-Off Nuclear Missile',        priority: 61 },

  // =========================================================================
  // TERMINOLOGY — 115 entries
  // Track A entries (1–60) stay at their current numbers — we still emit them
  // to ensure correctness, but only Track B movers will actually change.
  // =========================================================================

  // --- Track A — Operational Concepts (1–10) ---
  { category: 'Terminology', title: 'Destruction of Enemy Air Defences',    priority: 1  },
  { category: 'Terminology', title: 'Close Air Support',                    priority: 2  },
  { category: 'Terminology', title: 'Air-to-Air Refuelling',                priority: 3  },
  { category: 'Terminology', title: 'Airborne Early Warning & Control',     priority: 4  },
  { category: 'Terminology', title: 'ISTAR',                                priority: 5  },
  { category: 'Terminology', title: 'Humanitarian Assistance / Disaster Relief', priority: 6 },
  { category: 'Terminology', title: 'Defensive Counter Air',                priority: 7  },
  { category: 'Terminology', title: 'Offensive Counter Air',                priority: 8  },
  { category: 'Terminology', title: 'Air Interdiction',                     priority: 9  },
  { category: 'Terminology', title: 'Suppression of Enemy Air Defences',    priority: 10 },

  // --- Track A — Ops / Rules (11–20) ---
  { category: 'Terminology', title: 'Combat Search and Rescue',             priority: 11 },
  { category: 'Terminology', title: 'Non-Combatant Evacuation Operations',  priority: 12 },
  { category: 'Terminology', title: 'COMAO',                                priority: 13 },
  { category: 'Terminology', title: 'VMC',                                  priority: 14 },
  { category: 'Terminology', title: 'ROE',                                  priority: 15 },
  { category: 'Terminology', title: 'LOAC',                                 priority: 16 },
  { category: 'Terminology', title: 'PID',                                  priority: 17 },
  { category: 'Terminology', title: 'CDE',                                  priority: 18 },
  { category: 'Terminology', title: 'CONOPS',                               priority: 19 },
  { category: 'Terminology', title: 'OPORD',                                priority: 20 },

  // --- Track A — Intelligence (21–30) ---
  { category: 'Terminology', title: 'HUMINT',                               priority: 21 },
  { category: 'Terminology', title: 'SIGINT',                               priority: 22 },
  { category: 'Terminology', title: 'IMINT',                                priority: 23 },
  { category: 'Terminology', title: 'OSINT',                                priority: 24 },
  { category: 'Terminology', title: 'ELINT',                                priority: 25 },
  { category: 'Terminology', title: 'Pattern of Life',                      priority: 26 },
  { category: 'Terminology', title: 'FRAGORD',                              priority: 27 },
  { category: 'Terminology', title: 'Zulu Time',                            priority: 28 },
  { category: 'Terminology', title: 'METAR',                                priority: 29 },
  { category: 'Terminology', title: 'IFR / VFR',                            priority: 30 },

  // --- Track A — Aviation / ATC (31–40) ---
  { category: 'Terminology', title: 'NOTAM',                                priority: 31 },
  { category: 'Terminology', title: 'MAYDAY / PAN PAN',                     priority: 32 },
  { category: 'Terminology', title: 'MATZ',                                 priority: 33 },
  { category: 'Terminology', title: 'ADIZ',                                 priority: 34 },
  { category: 'Terminology', title: 'ILS',                                  priority: 35 },
  { category: 'Terminology', title: 'GCA',                                  priority: 36 },
  { category: 'Terminology', title: 'TACAN',                                priority: 37 },
  { category: 'Terminology', title: 'RVSM',                                 priority: 38 },
  { category: 'Terminology', title: 'Squawk / Squawk IDENT',                priority: 39 },
  { category: 'Terminology', title: 'Sortie',                               priority: 40 },

  // --- Track A — Combat Brevity (41–60) ---
  { category: 'Terminology', title: 'Strike Package',                       priority: 41 },
  { category: 'Terminology', title: 'Bingo Fuel',                           priority: 42 },
  { category: 'Terminology', title: 'Joker Fuel',                           priority: 43 },
  { category: 'Terminology', title: 'Winchester',                           priority: 44 },
  { category: 'Terminology', title: 'Bogey',                                priority: 45 },
  { category: 'Terminology', title: 'Bandit',                               priority: 46 },
  { category: 'Terminology', title: 'Tally',                                priority: 47 },
  { category: 'Terminology', title: 'No Joy',                               priority: 48 },
  { category: 'Terminology', title: 'Fox 1',                                priority: 49 },
  { category: 'Terminology', title: 'Fox 2',                                priority: 50 },
  { category: 'Terminology', title: 'Fox 3',                                priority: 51 },
  { category: 'Terminology', title: 'Splash',                               priority: 52 },
  { category: 'Terminology', title: 'Judy',                                 priority: 53 },
  { category: 'Terminology', title: 'Break',                                priority: 54 },
  { category: 'Terminology', title: 'Knock it off',                         priority: 55 },
  { category: 'Terminology', title: 'HOTAS',                                priority: 56 },
  { category: 'Terminology', title: 'G-LOC',                                priority: 57 },
  { category: 'Terminology', title: 'Vul Time',                             priority: 58 },
  { category: 'Terminology', title: 'TOT',                                  priority: 59 },
  { category: 'Terminology', title: 'Fence In / Fence Out',                 priority: 60 },

  // --- Track B — Engineering / Maintenance (61–67) ---
  { category: 'Terminology', title: 'Line Servicing / Line Maintenance',    priority: 61 },
  { category: 'Terminology', title: 'Form 700',                             priority: 62 },
  { category: 'Terminology', title: 'Military Aviation Authority',          priority: 63 },
  { category: 'Terminology', title: 'Aircraft on Ground',                   priority: 64 },
  { category: 'Terminology', title: 'Fly-to-Plan rate',                     priority: 65 },
  { category: 'Terminology', title: 'Release to Service',                   priority: 66 },
  { category: 'Terminology', title: 'OPSEC',                                priority: 67 },

  // --- Track B — Comms / Procedures (68–80) ---
  { category: 'Terminology', title: 'STANAG',                               priority: 68 },
  { category: 'Terminology', title: 'SITREP',                               priority: 69 },
  { category: 'Terminology', title: 'MINIMISE',                             priority: 70 },
  { category: 'Terminology', title: 'EMCON',                                priority: 71 },
  { category: 'Terminology', title: 'ATIS',                                 priority: 72 },
  { category: 'Terminology', title: 'IMC',                                  priority: 73 },
  { category: 'Terminology', title: 'TAF',                                  priority: 74 },
  { category: 'Terminology', title: 'LARS',                                 priority: 75 },
  { category: 'Terminology', title: 'TRA',                                  priority: 76 },
  { category: 'Terminology', title: 'PAR',                                  priority: 77 },
  { category: 'Terminology', title: 'CFIT',                                 priority: 78 },
  { category: 'Terminology', title: 'Spatial Disorientation',               priority: 79 },
  { category: 'Terminology', title: 'AIRPROX',                              priority: 80 },

  // --- Track B — More Engineering (81–89) ---
  { category: 'Terminology', title: 'Cherubs',                              priority: 81 },
  { category: 'Terminology', title: 'STANEVAL',                             priority: 82 },
  { category: 'Terminology', title: 'Rectification',                        priority: 83 },
  { category: 'Terminology', title: 'CAMO',                                 priority: 84 },
  { category: 'Terminology', title: 'Avionics Technician',                  priority: 85 },
  { category: 'Terminology', title: 'Technical Airworthiness Authority',    priority: 86 },
  { category: 'Terminology', title: 'Military Type Certificate',            priority: 87 },
  { category: 'Terminology', title: 'Out of Service Date',                  priority: 88 },
  { category: 'Terminology', title: 'Life Extension Programme',             priority: 89 },

  // --- Track B — Advanced Ops Concepts (90–102) ---
  { category: 'Terminology', title: 'OCA and DCA',                          priority: 90 },
  { category: 'Terminology', title: 'SEAD and DEAD',                        priority: 91 },
  { category: 'Terminology', title: 'Strategic Attack',                     priority: 92 },
  { category: 'Terminology', title: 'Battlefield Air Interdiction',         priority: 93 },
  { category: 'Terminology', title: 'Aeromedical Evacuation',               priority: 94 },
  { category: 'Terminology', title: 'Angel',                                priority: 95 },
  { category: 'Terminology', title: 'CASREP',                               priority: 96 },
  { category: 'Terminology', title: 'Composite Air Operations',             priority: 97 },
  { category: 'Terminology', title: 'Effects-Based Operations',             priority: 98 },
  { category: 'Terminology', title: 'Time-Sensitive Targeting',             priority: 99 },
  { category: 'Terminology', title: 'Deeper Depth Maintenance',             priority: 100 },
  { category: 'Terminology', title: 'No-Strike List',                       priority: 101 },
  { category: 'Terminology', title: 'IHL',                                  priority: 102 },

  // --- Track B — Tactical Targeting / Brevity (103–115) ---
  { category: 'Terminology', title: 'FSCL',                                 priority: 103 },
  { category: 'Terminology', title: 'FLOT',                                 priority: 104 },
  { category: 'Terminology', title: 'Buster',                               priority: 105 },
  { category: 'Terminology', title: 'Gate',                                 priority: 106 },
  { category: 'Terminology', title: 'Blind',                                priority: 107 },
  { category: 'Terminology', title: 'Friendly',                             priority: 108 },
  { category: 'Terminology', title: 'Pitbull',                              priority: 109 },
  { category: 'Terminology', title: 'Bravo Zulu',                           priority: 110 },
  { category: 'Terminology', title: 'SIGMET',                               priority: 111 },
  { category: 'Terminology', title: 'MASINT',                               priority: 112 },
  { category: 'Terminology', title: 'Bugsplat',                             priority: 113 },
  { category: 'Terminology', title: 'FEBA',                                 priority: 114 },
  { category: 'Terminology', title: 'Five Paragraph Order',                 priority: 115 },

  // =========================================================================
  // TRAINING — only 2 entries change (move youth programmes to end of list)
  // =========================================================================
  { category: 'Training', title: 'Combined Cadet Force RAF',                priority: 62 },
  { category: 'Training', title: 'Air Experience Flight',                   priority: 63 },

];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    const col = mongoose.connection.db.collection(COLLECTION);

    // Group updates by category for per-category reporting
    const byCategory = {};
    for (const u of updates) {
      if (!byCategory[u.category]) byCategory[u.category] = [];
      byCategory[u.category].push(u);
    }

    let grandTotalMatched = 0;
    let grandTotalModified = 0;

    for (const [category, entries] of Object.entries(byCategory)) {
      const ops = entries.map(({ title, priority }) => ({
        updateOne: {
          filter: { category, title },
          update: { $set: { priorityNumber: priority } },
        },
      }));

      const result = await col.bulkWrite(ops, { ordered: false });

      const matched  = result.matchedCount;
      const modified = result.modifiedCount;

      grandTotalMatched  += matched;
      grandTotalModified += modified;

      console.log(
        `[${category}]  ops: ${ops.length}  matched: ${matched}  modified: ${modified}`
      );
    }

    console.log('');
    console.log(`Done. Total matched: ${grandTotalMatched}  Total modified: ${grandTotalModified}`);

  } catch (err) {
    console.error('Error during bulkWrite:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
