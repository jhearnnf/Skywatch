---
name: Dark theme slate scale is inverted
description: In this Tailwind 4 dark theme, slate-50 is darkest and slate-900 is lightest — opposite of Tailwind defaults
type: feedback
---

The slate colour scale is remapped and **inverted** in `src/main.css`:

- `slate-50` = `#080e1c` (darkest)
- `slate-200` = `#172236` (very dark navy)
- `slate-400` = `#4a6282` (mid blue-grey)
- `slate-700` = `#aec0d8` (light blue-grey)
- `slate-900` = `#e8edf8` (near white / lightest)

**Why:** Custom `@theme` block remaps all slate tokens to a dark RAF palette.

**How to apply:** To make text *brighter/more readable*, go UP the scale (slate-600, slate-700, slate-800). Going down (slate-300, slate-200) makes it darker and less readable. Never assume Tailwind defaults apply here.
