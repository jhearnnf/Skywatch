// The "How to practise it on SkyWatch" copy for each public test page.
//
// Everything a candidate says about the REAL test lives in the guide's TESTS
// array (public/cbat-guide.html), so the guide and the pages can never disagree.
// This file only describes our own games, and it does so the way a player would
// see them, never the way the code builds them.
//
// The line this copy must not cross: what the game lets you practise is fine;
// how it generates questions, its timings and speeds, its scoring, its
// difficulty curve or its question counts are not. A competitor should learn
// nothing here they could not learn by playing for five minutes.
//
// House rules for on-screen copy: CBAT-style practice, never "the real test";
// no em dashes; "SkyWatch" with a capital W; plain words for a total newbie.

export const PRACTISE = {
  flag: [
    'Our FLAG game runs the three tasks together, the sums, the shapes and the callsigns, so you can practise splitting your attention before the day. There is an Easier board to learn the rules on and a harder one for when it clicks.',
    'A step-by-step tutorial walks through each task on its own before you combine them.',
  ],
  ant: [
    'Our ANT game gives you route maps, charts and questions to work through in your head, with an Easier board and a Hard board.',
    'The practise mode breaks every question down step by step, so you can see exactly where a wrong answer went wrong. You can play it without an account.',
  ],
  numops: [
    'Our Numerical Operations game is quickfire mental arithmetic against the clock, with an Easier board to warm up on.',
    'It pairs well with the ANT practice, because the same mental sums turn up across several tests.',
  ],
  cut: [
    'Our Cognitive Updating game gives you the six displays to manage with only two open at a time, so you can build the habit of keeping one eye on the warnings.',
    'There is an Easier board, and a guided tutorial that walks you through the displays before you play.',
  ],
  trt: [
    'Our Target game runs the four panels at once: the lights, the scan, the code list and the map. The tutorial unlocks the panels one by one, so you learn each task before you juggle them.',
    'You can play it without an account.',
  ],
  insc: [
    'Our Instruments game covers both parts: matching an aircraft picture to its dials, and picking the statement that fits a full set of instruments.',
    'A practise drill lets you fly with one dial at a time so you learn what each one tells you.',
  ],
  dpt: [
    'Our DPT game puts you on the radar picture with aircraft to steer through their gates and an interceptor to guide. Easier and Hard boards let you build up to the full load.',
    'The tutorial is a set of short drills on headings and heights, the part candidates most often find confusing on the day.',
  ],
  dad: [
    'Our Directions and Distances game gives you journeys in plain text and asks where the object ended up, with no map while you solve.',
    'Once you answer, the route is drawn out so you can see where your picture went wrong.',
  ],
  sat: [
    'Our SAT game shows you the grid, the units and the controller information, then takes it away and asks you about it.',
    'There is an Easier board, a tutorial, and a Real CBAT theme where answers are typed rather than picked, which is closer to what recent candidates describe.',
  ],
  sit: [
    'Our SIT game shows the landscape one layer at a time and then asks whether a detail in the scene is right.',
    'There is an Easier board to learn the format on before you take on the full version.',
  ],
  slt: [
    'Our SLT game gives you tabs of system information with only two readable at once, and questions that need values from more than one tab.',
    'There is an Easier board, so you can learn where things live before you race the clock.',
  ],
  act: [
    'Our ACT game has you steer a ball through the tunnel while you listen for your callsign, catch the beeps and hold a code.',
    'It works with a joystick if you have one, and with a mouse or touch if you do not. The Real CBAT theme adds the colour and number orders recent candidates describe.',
  ],
  trac: [
    'Our Trace games cover both tests: Trace 1, where you mirror the pilot’s inputs, and Trace 2, where you watch several aircraft and then answer questions about what happened.',
    'There are also simpler turning drills if you want to warm up first.',
  ],
  sma: [
    'Our SMA game is the drifting dot: keep it on the crosshair as it wanders.',
    'It runs on a joystick, a mouse, the keyboard or a touch pad, and if you have rudder pedals you can put the sideways movement on your feet like the real thing.',
  ],
  vissearch: [
    'Our Symbols game is a visual search grid: find the tile that matches the target and give its number, against the clock.',
    'You can play it without an account, and the skill carries into the table reading and vigilance tests too.',
  ],
  vis: [
    'Our Visualisation game has a 2D board and a 3D board: turning shapes in your head and fitting pieces together.',
  ],
  clan: [
    'Our CLAN game runs the three tasks together: the coloured dots, the letter strings and the sums. There is an Easier board and a choice of keyboard layouts.',
    'A slow-motion tutorial lets you learn the keys before the speed picks up.',
  ],
  abd: [
    'Our Angles game is quickfire estimation of angles and bearings, the same skill that helps on the DPT and DAD tests.',
  ],
  drt: [
    'Our Code Duplicates game flashes a string of digits and asks how many times one of them appeared.',
    'You can play it without an account.',
  ],
  matf: [
    'Our Table Reading game covers both parts: the coordinate grid and the three-step lookup.',
    'You can print the reference sheet and work from paper beside your screen, which is how the real test is described.',
  ],
  rtt: [
    'Our RTT game puts you behind a camera with a crosshair, photographing targets as they move and pass behind cover.',
    'It works with a joystick if you have one, and with a mouse or touch if you do not. There is an Easier board to learn the controls on.',
  ],
  vlt: [
    'Our Verbal Logic game gives you tabs of text on one subject with only two readable at once, and questions you answer by joining the dots between them.',
    'There is an Easier board to learn the format on.',
  ],
  vigil: [
    'Our Vigilance game is the star grid: clear the stars by typing their coordinates and catch the priority ones quickly.',
    'There is an Easier board, and a Hard board that is much busier, closer to what recent candidates describe.',
  ],
}

// Shown on every page under the practise copy. The disclaimer is not optional:
// we must never imply we have the real tests.
export const SIMULATION_NOTE =
  'Every SkyWatch game is our own CBAT-style practice version, built from what candidates report. None of them is the real test.'
