// Shared by the live app and the build-time public page renderer. Only the
// prerendered routes belong here: SEO.jsx lets these descriptions override the
// page's own prop, so the snapshot and the live app can never disagree.
export const PUBLIC_PAGE_SEO = {
  '/cbat': {
    description: 'Free CBAT-style practice. Play Target, ANT, Symbols and Code Duplicates without an account. Create a free account for the full suite.',
    selector: '.cbat-page',
  },
  '/cbat/target': {
    description: 'Play Target, a free CBAT-style multitasking practice game. Identify shapes, aircraft and codes in your browser. No account required.',
    selector: '.cbat-target-page',
  },
  '/cbat/ant': {
    description: 'Free Airborne Numerical Test (ANT) practice: work out speed, distance and time in your browser. No account required.',
    selector: '.cbat-ant-page',
  },
  '/cbat/symbols': {
    description: 'Play Symbols, a free CBAT-style visual search practice game. Find the matching symbol against the clock. No account required.',
    selector: '.cbat-symbols-page',
  },
  '/cbat/code-duplicates': {
    description: 'Play Code Duplicates, a free CBAT-style memory practice game. Remember digit sequences and count repetitions. No account required.',
    selector: '.cbat-code-duplicates-page',
  },
}
