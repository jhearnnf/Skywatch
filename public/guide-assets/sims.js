// Self-playing SkyWatch simulations embedded in the static country guides.
// Lifted from the UK guide's inline loader (public/cbat-guide.html) so the
// Canadian and Australian pages share one copy; the comment below is its.

/* ── Simulation frames: load on approach, unload on departure ──────────────
   Each frame boots a React app and several take a WebGL context, of which a
   browser grants somewhere under twenty per page. Ten frames left running as
   the reader scrolls would exhaust them (the earliest games lose their context
   and go black) and would keep a dozen animation loops burning through a
   document meant for twenty minutes of reading.

   So a frame gets a src only as it comes within a screen of the viewport, and
   loses it again once it is two screens away. Re-entering re-boots it, which is
   cheap next to keeping it alive and is invisible: the reader is looking at
   whatever is on screen, not at what they scrolled past. */
(function(){
  const frames = [...document.querySelectorAll('.simbox iframe')];
  if (!frames.length) return;

  /* No IntersectionObserver: load them all rather than show empty boxes. The
     cost is real but a blank square next to every test is worse. */
  if (typeof IntersectionObserver === 'undefined') {
    frames.forEach(f => { f.src = f.dataset.src; });
    return;
  }

  const load = f => { if (!f.src) f.src = f.dataset.src; };

  /* Unloading by pointing the frame at about:blank frees the WebGL context but
     leaves a session-history entry behind: navigating a frame that already holds
     a document appends to the *parent's* history in every browser. Ten frames
     loading and unloading as the reader scrolls buries the entry they arrived
     from, and the back button stops leaving the guide. It just sits here,
     rewinding invisible iframe navigations one press at a time.

     So discard the element instead of navigating it. A freshly created frame
     sits on its initial about:blank, and a script navigation from *that*
     replaces rather than appends, so neither unloading nor re-loading writes
     history. The old document, and its WebGL context, go with the old node. */
  const unload = f => {
    if (!f.src) return;
    const fresh = f.cloneNode(false);
    fresh.removeAttribute('src');
    near.unobserve(f); far.unobserve(f);
    f.replaceWith(fresh);
    near.observe(fresh); far.observe(fresh);
  };

  const near = new IntersectionObserver(
    es => es.forEach(e => { if (e.isIntersecting) load(e.target); }),
    { rootMargin: '100% 0px' },
  );
  const far = new IntersectionObserver(
    es => es.forEach(e => { if (!e.isIntersecting) unload(e.target); }),
    { rootMargin: '200% 0px' },
  );
  frames.forEach(f => { near.observe(f); far.observe(f); });
})();
