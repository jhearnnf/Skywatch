// Synthetic cursor, injected into the page before capture.
//
// CDP screencast records the page's own compositor output, which does not
// include the operating system's mouse pointer. Without this, a feature demo
// shows the UI reacting to nothing at all — buttons highlighting and panels
// opening with no visible cause, which reads as a glitch rather than a demo.
//
// Playwright's mouse actions dispatch real input events, so tracking
// pointermove is enough to follow them.

const CURSOR_SCRIPT = `
(() => {
  if (window.__clipperCursor) return;
  window.__clipperCursor = true;

  const dot = document.createElement('div');
  dot.setAttribute('data-clipper-cursor', '');
  Object.assign(dot.style, {
    position: 'fixed', top: '0', left: '0', width: '28px', height: '28px',
    marginLeft: '-14px', marginTop: '-14px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.92)',
    boxShadow: '0 0 0 3px rgba(91,170,255,0.9), 0 4px 14px rgba(0,0,0,0.45)',
    pointerEvents: 'none', zIndex: '2147483647',
    transform: 'translate3d(-100px,-100px,0)',
    transition: 'transform 60ms linear',
  });

  const attach = () => {
    if (document.body && !dot.isConnected) document.body.appendChild(dot);
  };
  attach();
  document.addEventListener('DOMContentLoaded', attach);

  document.addEventListener('pointermove', (e) => {
    attach();
    dot.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  }, true);

  // A tap ripple: without it a click on an already-hovered control is invisible.
  document.addEventListener('pointerdown', (e) => {
    attach();
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px',
      width: '10px', height: '10px', marginLeft: '-5px', marginTop: '-5px',
      borderRadius: '50%', border: '3px solid rgba(91,170,255,0.95)',
      pointerEvents: 'none', zIndex: '2147483646',
      transition: 'all 420ms ease-out', opacity: '1',
    });
    document.body.appendChild(ring);
    requestAnimationFrame(() => {
      ring.style.width = '90px'; ring.style.height = '90px';
      ring.style.marginLeft = '-45px'; ring.style.marginTop = '-45px';
      ring.style.opacity = '0';
    });
    setTimeout(() => ring.remove(), 480);
  }, true);
})();
`;

module.exports = { CURSOR_SCRIPT };
