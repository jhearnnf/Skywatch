# Google Play Store Listing — SkyWatch CBAT

All three fields below are edited in **Google Play Console**
(Grow > Store presence > Main store listing). None of them live in the repo.

Do not confuse the app title below with `app_name` in
`android/app/src/main/res/values/strings.xml` — that string is the homescreen
launcher label, which Android truncates at roughly 10-12 characters. It stays
short (`SkyWatch CBAT`) on purpose.

---

## App title (30 char limit — currently 29)

```
SkyWatch: CBAT Practice Tests
```

Brand first so every truncation still shows "SkyWatch", which is the name
people actually use when recommending the app. "Practice" targets the
"cbat practice test" query; "military" is carried by the short description
instead, to save title budget.

---

## Short description (80 char limit — currently 77)

```
CBAT & military aircrew aptitude tests: spatial, memory & multitasking games.
```

Second-most-weighted indexed field on Play after the title. Lands CBAT,
military, aircrew, aptitude, tests, spatial, memory, multitasking, games.

---

## Full description (4000 char limit — currently ~2700)

```
CBAT Practice Tests | Aircrew Aptitude | Spatial, Memory & Multitasking

SkyWatch CBAT is a modern training platform built to sharpen the cognitive skills measured in military and aviation selection testing. Train working memory, mental arithmetic, spatial reasoning, multitasking and sustained attention through fast, timed mini-games - online or completely offline, anywhere.

Whether you are preparing for the RAF CBAT, USAF AFOQT/TBAS, or international aircrew aptitude testing, SkyWatch builds the mental muscle you need on test day.

🎮 THE GAMES & TEST MODULES
Train across a growing suite of cognitive games modelled on real aptitude test domains:

DPT (Bearings & Vectors): Vector multiple aircraft through designated gates using dynamic compass bearings.

FLAG (High-Speed Processing): Combine tracking, quick maths and target identification in under 60 seconds.

Target (Multitasking): Juggle eight live panels at once. Hunt shapes, match lights, identify aircraft silhouettes and solve codes under pressure.

CUT (Cognitive Updating): Monitor six aircraft displays at once - hold fuel, speed, sensors, pressure and load drops in tolerance while the warnings stack up.

ANT (Speed, Distance, Time): Rapid-fire mental maths problems against a ticking clock.

Trace 1 & 2 (Spatial Memory): Watch complex aircraft manoeuvres, then recall trajectories and positions accurately.

Visualisation (2D & 3D Spatial Reasoning): Mentally fold 2D shapes or rotate complex 3D composites to locate the matching figure.

ACT (Audio Multitasking): Track callsigns by ear while simultaneously reacting to dynamic visual cues.

DAD (Spatial Orientation): Follow complex journey legs from text-based relative turns, then calculate the return vector.

SAT (Tactical Awareness): Analyse complex tactical pictures in brief bursts, then recall vital details under pressure.

Core Aptitude Boosters: Practise Instrument Comprehension, Angles, Code Duplicates, Symbols and Rapid Numerical Operations.

✨ KEY FEATURES

100% Offline Mode: Train anywhere. Play on commutes or in low-signal areas, and your scores sync to the global leaderboards automatically once you reconnect.

Guided Interactive Tutorials: Step-by-step walkthroughs introduce game mechanics gradually so you learn the strategy before hitting the timer.

Weekly & All-Time Leaderboards: Compete against fellow candidates on fresh weekly boards, or aim for the all-time high score.

Detailed Performance Analytics: Track every score over time to pinpoint your cognitive strengths and focus on the areas that need work.

✈️ WHO IS THIS FOR?
Built for candidates preparing for aircrew, pilot and air traffic control (ATC) selection, including:

UK: Royal Air Force (RAF) CBAT and Royal Navy Fleet Air Arm

USA: AFOQT and TBAS (Air Force), ASTB-E (Navy and Marine Corps), SIFT (Army)

Canada: RCAF Aircrew Selection

Australia & New Zealand: ADF Aircrew Testing / RNZAF

Civil Aviation: Pilot aptitude screening and cadet assessments

Important Disclaimer:
SkyWatch CBAT is an independent training tool created to help candidates build general cognitive skills. It is not affiliated with, endorsed by, or connected to the UK Ministry of Defence, Royal Air Force, US Department of Defense, or any official government entity or testing body. It does not reproduce actual proprietary test content.
```

---

## Screenshot captions

Store screenshots are **not** OCR'd for search ranking by either Play or the App
Store — captions are a conversion lever, not an SEO one. The first two or three
appear in Play search results before anyone taps through, so order matters more
than wording.

Set headlines in Inter ExtraBold or Black, all caps, tracking +30, in the banner
area *outside* the phone frame. Sublines in Inter Regular, sentence case. On a
1080 x 1920 canvas: headline 90-110pt, subline 40-48pt. Colours `#ddeaf8` or
white on `#06101e`, with `#5baaff` on one emphasised word. Test every caption at
15% scale before shipping it.

Listed in intended screenshot order.

| # | Game | Headline | Subline |
|---|------|----------|---------|
| 1 | Target | `EIGHT TASKS. ZERO DOWNTIME.` | Shapes, lights, aircraft and codes at once |
| 2 | FLAG | `60 SECONDS. THREE TASKS.` | Track, calculate, identify |
| 3 | DPT | `VECTOR AIRCRAFT THROUGH GATES` | Compass bearings under pressure |
| 4 | Visualisation | `FOLD IT. ROTATE IT. MATCH IT.` | 2D and 3D spatial reasoning |
| 5 | Trace | `WATCH. REMEMBER. RECALL.` | Rebuild the manoeuvre from memory |
| 6 | Instruments | `READ THE COCKPIT FAST` | Instrument comprehension against the clock |
| 7 | Symbols | `FIND THE SYMBOL` | The grid grows every round |

Instruments and Symbols are the least visually distinctive screens, which is why
they sit last.

**Still outstanding:** there is no lead screenshot selling the app rather than an
individual game. Something like `TRAIN THE SKILLS SELECTION TESTS MEASURE` over
the Target screen, with Target's own caption moving to position two.

### Per-game keywords for the full description

These belong in the Play Console description, which *is* indexed - not on the
images.

- **DPT** - dynamic projection test, compass bearings, vectoring, intercepts, spatial orientation
- **FLAG** - high-speed processing, mental maths, target identification, divided attention, reaction speed
- **Instruments** - instrument comprehension, cockpit instruments, attitude indicator, pilot aptitude
- **Symbols** - visual search, perceptual speed, pattern recognition, sustained attention
- **Target** - multitasking, divided attention, working memory, task switching, aircraft recognition
- **Trace** - spatial memory, trajectory recall, mental rotation, aircraft manoeuvres
- **Visualisation** - spatial reasoning, mental rotation, shape matching, 2D and 3D

## Editing rules for this listing

- **UK spelling throughout** — modelled, manoeuvres, Analyse, maths, Practise
  (verb), Visualisation. The last one is also the in-app game name.
- **Hyphens, never em dashes.**
- **Never state a game count** — say "a growing suite" so the copy does not go
  stale when games are added.
- **Keep the independence disclaimer**, and keep the sentence "It does not
  reproduce actual proprietary test content." That line does the real
  protective work alongside the non-affiliation wording.
- **Never use the RAF roundel, crest, eagle or official typefaces** in the
  icon, feature graphic or screenshots. Referential use of the words in a
  disclaimed sentence is ordinary practice; the imagery is what gets enforced.
- Keep games in sync with `src/data/cbatGames.js`. CUT and SAT are the most
  recent additions.

## Changes from the previous version (2026-07-29)

- Fixed a missing line break that ran "Multitasking" into "SkyWatch" in the
  opening line.
- Added CUT, which was shipped and flagged `isNew` but absent from the listing.
- Corrected the US test grouping: ASTB-E is Navy/Marine Corps and SIFT is Army,
  not Air Force. Named the Royal Navy Fleet Air Arm properly.
- Moved offline play into the opening paragraph and to the top of Key Features.
- Dropped "the exact mental muscle" — "exact" conflicted with the disclaimer's
  no-reproduction line.
- Header line now leads with "CBAT Practice Tests" instead of "Master", which
  had no search volume.
- Short description now contains "CBAT", which it previously did not.
