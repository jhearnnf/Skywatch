import { flushSync } from 'react-dom'
import { applyUiTheme } from './uiTheme'

// The page-wide reveal that plays when a phone's hold-to-switch completes:
// the new theme grows out of the point under the thumb as a circle until it
// covers the screen (`--theme-vt-x/y` place the circle; the keyframes live in
// main.css under "theme-reveal").
//
// Where the browser has the View Transitions API the old page is snapshotted
// and the new one is revealed through it, so every element re-skins in the
// same sweep. Elsewhere a veil in the new theme's ground colour grows over
// the page, the theme flips under it, and the veil fades.
//
// `commit` is the React state flip; it runs inside flushSync so the new
// snapshot is the re-skinned page, not the old one a frame later.

const GROUND = { skywatch: '#06101e', cbat: '#000080' }

export function animateThemeSwitch(commit, { x, y }, nextTheme) {
  const root = document.documentElement
  root.style.setProperty('--theme-vt-x', `${Math.round(x)}px`)
  root.style.setProperty('--theme-vt-y', `${Math.round(y)}px`)

  const flip = () => {
    // Stamp the attribute now rather than waiting for useUiTheme's effect, so
    // the transition captures the finished look.
    applyUiTheme(nextTheme)
    flushSync(commit)
  }

  if (typeof document.startViewTransition === 'function') {
    root.classList.add('theme-switching')
    const vt = document.startViewTransition(flip)
    return vt.finished.finally(() => root.classList.remove('theme-switching'))
  }

  const veil = document.createElement('div')
  veil.className = 'theme-switch-veil'
  veil.style.background = GROUND[nextTheme] ?? GROUND.skywatch
  if (typeof veil.animate !== 'function') { flip(); return Promise.resolve() }
  document.body.appendChild(veil)
  const at = `${Math.round(x)}px ${Math.round(y)}px`
  const grow = veil.animate(
    [{ clipPath: `circle(0px at ${at})` }, { clipPath: `circle(160vmax at ${at})` }],
    { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  )
  return grow.finished
    .then(() => {
      flip()
      return veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' }).finished
    })
    .finally(() => veil.remove())
}
