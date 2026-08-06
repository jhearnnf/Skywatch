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
      // The briefing is worth a beat on camera — it explains the task, which
      // is exactly what a viewer needs before watching someone attempt it.
      { do: 'wait', ms: 2500 },
      { do: 'scroll', by: 600, overMs: 2000 },
      // There is no separate Start button: picking an aircraft begins the run.
      // Every card is labelled "3D <name>", so the first match is a valid
      // choice regardless of which aircraft the database happens to hold.
      { do: 'click', selector: 'button:has-text("3D ")' },
      { do: 'wait', ms: 1500 },
      { do: 'idle', ms: 20000 },
    ],
  },
};

function getRecipe(id) {
  const recipe = RECIPES[id];
  if (!recipe) {
    throw new Error(`Unknown capture recipe "${id}" - known: ${Object.keys(RECIPES).join(', ')}`);
  }
  return recipe;
}

module.exports = { RECIPES, getRecipe };
