// Capture recipes — declarative scripts for driving the site on camera.
//
// Kept as data rather than code so the AI can name one in a script beat
// (`visual.recipeId`) without being able to invent arbitrary browser actions.
// Same principle as briefReelAi's closed action enums: the model chooses from a
// list we can actually perform.
//
// Selectors use data-testid where possible. When a recipe breaks because the UI
// moved, the job fails loudly with the step that could not run — much better
// than silently recording a blank page.
//
// ── One recipe per promotable game ──────────────────────────────────────────
// Hand-writing a recipe per game does not scale and, worse, it decided what the
// channel could talk about: for a long time DPT was the only game with a
// recipe, so every "feature" video either showed DPT or showed no product at
// all. `play-<key>` recipes are therefore generated from the subject table, and
// only games that were never given one by hand fall back to the generic shape.
//
// The generic shape leans on the two attributes the landing page's demo driver
// already relies on — [data-demo-start] to begin play and [data-demo-answer] to
// keep it moving — so it needs no per-game knowledge and cannot wander into a
// Back or Quit button. See src/components/landingGames/demoDriver.js; the
// `demoPlay` step is that driver, run from the capture handler.

const { SUBJECTS } = require('../../backend/constants/clipperSubjects');

const RECIPES = {
  'cbat-home': {
    label: 'Browse the CBAT games menu',
    requiresAuth: true,
    estDurationSec: 12,
    steps: [
      { do: 'goto', path: '/cbat' },
      { do: 'wait', ms: 1200 },
      { do: 'scroll', by: 500, overMs: 2500 },
      { do: 'wait', ms: 800 },
      { do: 'scroll', by: 500, overMs: 2500 },
      { do: 'wait', ms: 1000 },
    ],
  },

  'browse-leaderboard': {
    label: 'Scroll a CBAT leaderboard',
    requiresAuth: true,
    estDurationSec: 12,
    steps: [
      { do: 'goto', path: '/cbat/leaderboard' },
      { do: 'wait', ms: 1500 },
      { do: 'scroll', by: 400, overMs: 2500 },
      { do: 'wait', ms: 1500 },
      { do: 'scroll', by: 400, overMs: 2500 },
      { do: 'wait', ms: 1000 },
    ],
  },

  'play-dpt': {
    label: 'Play the DPT game',
    requiresAuth: true,
    estDurationSec: 30,
    steps: [
      { do: 'goto', path: '/cbat/dpt' },
      // A brief look at the briefing — it names the task, which is what a
      // viewer needs before watching an attempt. Deliberately short: this is
      // b-roll under a two-second line, and an earlier version spent five of
      // its thirty seconds here, so a beat trimmed from the start of the clip
      // saw nothing but instructions.
      { do: 'waitFor', selector: 'text=Dynamic Projection Test' },
      { do: 'wait', ms: 900 },
      { do: 'scroll', by: 600, overMs: 1200 },

      // [data-demo-start] marks "the control that starts play" site-wide (see
      // components/landingGames/demoDriver.js) and every CBAT game carries it.
      // The previous selector, `button:has-text("3D ")`, described one
      // rendering of the aircraft cards rather than what the button is for.
      { do: 'waitFor', selector: '[data-demo-start]' },
      { do: 'click', selector: '[data-demo-start] >> nth=0' },

      // Picking an aircraft plays a 1.8s logo intro before the arena mounts.
      // Waiting for the arena itself rather than sleeping past it is the
      // difference between twenty seconds of gameplay and twenty seconds that
      // began mid-curtain: the old fixed 1500ms wait was shorter than the
      // intro, so the idle started while the logo was still on screen.
      { do: 'waitFor', selector: 'text=BRG (heading)' },

      // The arena mounts BEHIND the 1.8s logo intro, and the game's key
      // listener is only attached once the phase leaves 'intro'. So "the arena
      // is visible" is true well before the game accepts input, and keystrokes
      // sent then are silently dropped — which is exactly what swallowed the
      // round-skip below the first time. Wait for the curtain, not the stage.
      { do: 'waitForGone', selector: '[data-testid="skywatch-logo-intro"]' },

      // Jump to round 5, so the clip shows a busy board rather than round 1's
      // two aircraft. 555 is the game's existing admin round-skip cheat
      // (ADMIN_ROUND_CHEATS in src/pages/CbatDpt.jsx) — the run is flagged
      // debug and never reaches the leaderboard, which is what we want from a
      // recording anyway.
      //
      // This is the round-skip, not a time warp: it starts round 5 cleanly
      // rather than fast-forwarding four rounds of physics.
      { do: 'keys', keys: ['5', '5', '5'] },
      { do: 'wait', ms: 1200 },

      // Actually play. Each command is "select aircraft, pick a turn
      // direction, steer a bearing" — the same three keystrokes a person uses.
      // Without this the arena is four aircraft flying straight, which looks
      // like a screensaver rather than a test.
      {
        do: 'play',
        ms: 20000,
        gapMs: 1900,
        commands: [
          ['a', 'ArrowRight', '0', '9', '0'],
          ['n', 'ArrowLeft', '2', '7', '0'],
          ['a', 'ArrowLeft', '1', '8', '0'],
          ['n', 'ArrowRight', '3', '5', '0'],
          ['a', 'ArrowRight', '0', '4', '5'],
          ['n', 'ArrowLeft', '2', '2', '5'],
        ],
      },

      // A run that ended early leaves a clip of the menu, and in the job log
      // that is indistinguishable from a good recording.
      { do: 'assertVisible', selector: 'text=BRG (heading)' },
    ],
  },
};

// Film one game being played, using only the site-wide demo markers.
//
// Deliberately short on assertions. `assertVisible` at the end catches the
// worst failure — the run quit and the clip is of a menu — but "the game was
// visibly being played" is not something a selector can settle, and a recipe
// that fails loudly on a healthy game costs a twenty-second recording. Pull
// frames before trusting a new game's first capture.
function genericGameRecipe(subject) {
  const playMs = subject.playMs || 18000;
  return {
    label: `Play ${subject.spokenName}`,
    requiresAuth: true,
    // Navigation, briefing, intro curtain and play, plus headroom.
    estDurationSec: Math.round(playMs / 1000) + 10,
    steps: [
      { do: 'goto', path: subject.path },

      // The start control is the game having finished mounting. Waiting for it
      // rather than sleeping is what keeps this working on a slow first load of
      // an R3F game, where a fixed wait would film a spinner.
      { do: 'waitFor', selector: '[data-demo-start]' },
      // A moment on the briefing: it names the task, which is what a viewer
      // needs before watching an attempt. Kept under a second - this is b-roll
      // beneath a two-second line, not an explainer.
      { do: 'wait', ms: 900 },

      { do: 'click', selector: '[data-demo-start] >> nth=0' },

      // Games mount their arena BEHIND a 1.8s logo intro and only bind input
      // once it clears, so anything sent before this is dropped in silence.
      // Harmless on the games that show no intro: a selector that was never
      // present is already hidden.
      { do: 'waitForGone', selector: '[data-testid="skywatch-logo-intro"]' },

      { do: 'demoPlay', ms: playMs, intervalMs: subject.answerIntervalMs || 0 },

      // Something of the game still on screen. A comma list rather than a
      // precise selector because the alternative is a per-game stage selector
      // that rots quietly the first time a layout moves.
      { do: 'assertVisible', selector: '[data-demo-answer], [data-demo-start], canvas' },
    ],
  };
}

// Hand-tuned recipes win. play-dpt knows the game's round-skip cheat and issues
// real bearing commands, which no generic driver can infer.
for (const subject of SUBJECTS) {
  if (subject.kind !== 'game') continue;
  if (RECIPES[subject.recipeId]) continue;
  RECIPES[subject.recipeId] = genericGameRecipe(subject);
}

function getRecipe(id) {
  const recipe = RECIPES[id];
  if (!recipe) {
    throw new Error(`Unknown capture recipe "${id}" - known: ${Object.keys(RECIPES).join(', ')}`);
  }
  return recipe;
}

module.exports = { RECIPES, getRecipe, genericGameRecipe };
