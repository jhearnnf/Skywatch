// `?difficulty=hard` on a split game's route: which difficulty its instructions
// card opens on, for this arrival only.
//
// It exists for the Aptitude Report. That page scores Hard runs and nothing
// else, so every "play this to level up" link on it has to land on a card with
// Hard already selected. Without this a user follows the advice, plays the
// difficulty the card happened to remember (Easier by default), and the run
// does nothing for the score they clicked to raise — the report would be
// telling them to do something and then quietly sending them somewhere else.
//
// Deliberately NOT written to localStorage. This says "start here this time",
// not "you now prefer Hard"; the stored choice is the user's own, made by
// pressing a button on the card, and a link should not overwrite it. Pressing
// the button still does, exactly as before.
//
// Read from window.location rather than useSearchParams so it can be used
// inside a useState initialiser without every game page needing router context
// — they are mounted at a route and the param is only ever read on arrival.

export const DIFFICULTY_PARAM = 'difficulty';

const VALID = ['easier', 'hard'];

// The difficulty asked for in the URL, or null if there isn't a valid one.
export function forcedDifficulty(search) {
  try {
    const raw = new URLSearchParams(search ?? window.location.search).get(DIFFICULTY_PARAM);
    return VALID.includes(raw) ? raw : null;
  } catch {
    return null;  // no window (SSR, some test envs), no forcing
  }
}

// What a game's difficulty state should start on: the URL's choice if it made
// one, otherwise the game's own remembered choice.
export function initialDifficulty(readStored, search) {
  return forcedDifficulty(search) ?? readStored();
}
