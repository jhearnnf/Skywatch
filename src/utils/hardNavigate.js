// A full page load to `href`. Its own module so tests can stub it; jsdom will
// not let window.location.assign be spied on.
export function hardNavigate(href) {
  window.location.assign(href)
}
