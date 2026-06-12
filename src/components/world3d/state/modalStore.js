// Tiny pub-sub for in-world modals. Interactables inside the R3F Canvas
// can't render DOM themselves; they dispatch a modal spec here and a
// <ModalLayer> mounted in the DOM tree subscribes and renders it.

let current = null
const listeners = new Set()

export const modal = {
  get() { return current },
  open(spec) { current = spec; notify() },
  close() { if (current) { current = null; notify() } },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
}

function notify() { for (const fn of listeners) fn() }
