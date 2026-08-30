// Capture job — record the real site as b-roll.
//
// ── Isolation ───────────────────────────────────────────────────────────────
// The bot logs in and plays games, which writes scores, Airstars and
// leaderboard rows. The local backend normally talks to the DEPLOYED database
// (see project_local_uses_prod_mongo), so pointing this at the usual dev server
// would put fake results on the live leaderboard every time a clip is recorded.
//
// CLIPPER_CAPTURE_BASE_URL must therefore be a site instance backed by a
// throwaway local database. The handler refuses to run against anything that
// does not look local, which is a blunt check but the failure it prevents is
// public and hard to undo.
//
// ── Framing ─────────────────────────────────────────────────────────────────
// CDP screencast captures at CSS pixel size and ignores deviceScaleFactor
// entirely — a 432x768 viewport at DSF 2.5 yields 432x768 frames, not
// 1080x1920. maxWidth/maxHeight are caps, so they cannot force it upward
// either. That is a hard constraint, not something to configure around.
//
// So we capture at the LARGEST viewport that still triggers the app's mobile
// layout (the breakpoint is 600px, so 596 is the practical ceiling) and upscale
// to 1080x1920 at encode time. Capturing at 432 and scaling 2.5x would be
// noticeably softer; from 596 it is a 1.81x scale, and the result is viewed on
// a phone at around 450px wide anyway.
//
// Mobile layout matters because it puts BottomNav on screen and lays the app
// out in a single column — the right look for short-form, with no cropping.

const path = require('path');
const os = require('os');
const { CURSOR_SCRIPT } = require('../capture/cursor');
const { record } = require('../capture/recorder');
const {
  makeRng, createHand, digitTargets, between, HESITATE_RATE, MISS_RATE,
} = require('../capture/humanInput');
const { getRecipe } = require('../recipes');

// 596 x 1060 is 9:16 and sits just under the 600px mobile breakpoint.
const VIEWPORT = { width: 596, height: 1060 };
const OUTPUT = { width: 1080, height: 1920 };

// Read at call time, not module load. Capturing these at import makes the
// handler depend on dotenv having run before the require — and when it has not,
// the fallback silently points the bot at the ordinary dev server, which is
// backed by the production database. Exactly the failure the safety checks
// exist to prevent, arriving through the back door.
const baseUrl = () =>
  (process.env.CLIPPER_CAPTURE_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const isHeadless = () =>
  String(process.env.CLIPPER_CAPTURE_HEADLESS || 'false') === 'true';

function assertSafeTarget(url) {
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.local') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (!local) {
    throw new Error(
      `Refusing to capture against "${host}". The bot writes real game results, so the ` +
      'target must be a local instance backed by a throwaway database.',
    );
  }

  // A hostname check is NOT sufficient, and it is important to be clear why.
  // http://localhost:5173 is the ordinary dev server, and this project's local
  // backend points at the DEPLOYED database (project_local_uses_prod_mongo).
  // So "local URL" and "disposable data" are completely different claims, and
  // only the operator can confirm the second one.
  //
  // Once a signed-in bot plays a game the write is public and awkward to undo,
  // so this fails closed rather than inferring safety from the port number.
  if (process.env.CLIPPER_CAPTURE_DISPOSABLE !== 'yes') {
    throw new Error(
      `Refusing to capture against ${url}: not confirmed as disposable.\n` +
      'The capture bot signs in and plays games, and a local URL can still be backed by the ' +
      'production database. Point the site at a seeded throwaway database ' +
      '(backend/scripts/seedClipperDemoData.js), then set CLIPPER_CAPTURE_DISPOSABLE=yes ' +
      'in clipper-agent/.env to confirm.',
    );
  }
}

// Sign the bot in before a recipe that needs an account.
//
// Done as a real form submission rather than by injecting a token: the whole
// point of these clips is to show the actual product, and a session created by
// any other route might not match what a real sign-in produces.
async function signIn(page) {
  const email = process.env.CLIPPER_DEMO_EMAIL || 'clipper-demo@skywatch.local';
  const password = process.env.CLIPPER_DEMO_PASSWORD || 'clipper-demo-password';

  await page.goto(`${baseUrl()}/login`, { waitUntil: 'domcontentloaded' });

  // The login page opens on a chooser; the email form is behind this.
  //
  // Clicked in a retry loop because Playwright considers a button clickable as
  // soon as it is painted and stable, which on a cold page load is before React
  // has attached its onClick. That first click then does nothing at all, and
  // the failure surfaces ten seconds later as "#email never appeared" — a
  // hydration race wearing a missing-selector costume.
  let revealed = false;
  for (let attempt = 0; attempt < 4 && !revealed; attempt++) {
    await page.click('text=Sign In with Email', { timeout: 10000 }).catch(() => {});
    revealed = await page.waitForSelector('#email', { timeout: 4000 })
      .then(() => true).catch(() => false);
  }
  if (!revealed) {
    throw new Error(`The email sign-in form never appeared at ${page.url()}`);
  }

  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');

  // Signed in when we are no longer on /login. Failing here rather than
  // recording the sign-in screen is the point — a silent failure produces a
  // clip that looks fine in the job log and is useless in the video.
  //
  // waitForURL, not waitForFunction: the redirect destroys the page's execution
  // context, so an in-page predicate throws mid-navigation and reports a
  // successful sign-in as a failure.
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  } catch (err) {
    // Report what actually went wrong. Collapsing every failure into one
    // guess ("is the database seeded?") sent me chasing a seeding problem
    // when the real fault was in the wait itself.
    const onPage = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('p,span,div')]
        .map(e => (e.textContent || '').trim())
        .find(t => t && t.length < 120 && /incorrect|invalid|failed|not found|wrong|required/i.test(t));
      return hit || null;
    }).catch(() => null);

    throw new Error(
      `Sign-in did not complete for ${email} at ${page.url()}` +
      (onPage ? ` - page says: "${onPage}"` : '') +
      ` (${err.message.split('\n')[0]})`,
    );
  }
}

// A reload wipes the page's JS context, so a marker set on `window` is a
// direct test for "did this document survive". Deliberately not a navigation
// listener: SPA route changes fire those too, and an in-app navigation is not
// what ruins a recording — a full boot is, because the clip then shows the
// splash screen and the app starting up instead of whatever it was pointed at.
const MARK = '__clipperCaptureDocument';

const RELOADED =
  'The page reloaded part-way through the recording, so most of the clip is the app booting '
  + 'rather than what the recipe was filming. A Vite dev-server HMR reload does this - do not '
  + 'edit files while a capture runs, or point CLIPPER_CAPTURE_BASE_URL at a built preview '
  + '(npm run build && npm run preview) instead of the dev server.';

const markDocument = (page) => page.evaluate((k) => { window[k] = true; }, MARK);
const documentSurvived = (page) =>
  page.evaluate((k) => Boolean(window[k]), MARK).catch(() => false);

// The pressable controls currently on screen, with the geometry needed to aim
// at them.
//
// Read from Playwright rather than from inside the page because the whole point
// is to click at real coordinates: a bounding box is the only thing that turns
// "this element" into "this point on screen", and a point is what produces a
// visible cursor, a correctly-placed ripple and a real hit test.
//
// `label` carries the control's text so a keypad can be recognised without
// knowing which game is on screen (see digitTargets).
async function collectTargets(page) {
  const handles = await page.$$('[data-demo-answer], [data-demo-start]');
  const targets = [];

  for (const handle of handles) {
    // A box of null means not rendered; zero area means present but collapsed.
    // Either way there is nothing to aim at, and clicking its centre would land
    // on whatever is behind it.
    const box = await handle.boundingBox().catch(() => null);
    if (!box || box.width < 2 || box.height < 2) continue;

    const info = await handle.evaluate((el) => ({
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      answer: el.hasAttribute('data-demo-answer'),
      label: (el.textContent || '').trim().slice(0, 8),
    })).catch(() => null);
    if (!info || info.disabled) continue;

    targets.push({ box, label: info.label, role: info.answer ? 'answer' : 'start' });
  }

  return targets;
}

async function runStep(page, step, progress, ctx = {}) {
  switch (step.do) {
    case 'goto':
      await page.goto(`${baseUrl()}${step.path}`, { waitUntil: 'domcontentloaded' });
      // Re-mark: this navigation is the recipe's own doing, not a reload.
      await markDocument(page);
      break;

    case 'wait':
      await page.waitForTimeout(step.ms ?? 500);
      break;

    // Wait for the thing itself instead of guessing how long it takes. Fixed
    // sleeps are why an idle step could start while a 1.8s intro animation was
    // still playing and spend its whole budget filming a curtain.
    case 'waitFor':
      try {
        await page.waitForSelector(step.selector, {
          state: 'visible',
          timeout: step.timeoutMs ?? 15000,
        });
      } catch {
        throw new Error(
          `Timed out waiting for "${step.selector}". The recipe expected it on screen by now — ` +
          'the UI has probably moved, or the step before this one did not do what it used to.',
        );
      }
      break;

    // Wait for something to go away. The counterpart to waitFor, and the only
    // reliable way past a curtain: a game mounts its arena behind the logo
    // intro, so waiting for the arena says nothing about whether the game is
    // accepting input yet.
    case 'waitForGone':
      try {
        await page.waitForSelector(step.selector, {
          state: 'hidden',
          timeout: step.timeoutMs ?? 15000,
        });
      } catch {
        throw new Error(
          `"${step.selector}" was still on screen after ${step.timeoutMs ?? 15000}ms. ` +
          'The recipe is waiting for it to clear before carrying on.',
        );
      }
      break;

    // The end-of-recipe check. A run that quit early records the menu, which
    // looks exactly like success in the job log.
    case 'assertVisible': {
      const visible = await page.isVisible(step.selector).catch(() => false);
      if (!visible) {
        throw new Error(
          `"${step.selector}" was gone by the end of the recipe, so the recording does not show ` +
          'what it was meant to. The run ended early - check the clip before trusting it.',
        );
      }
      break;
    }

    case 'click':
      await page.click(step.selector, { timeout: 5000 });
      break;

    case 'clickIfPresent': {
      // Deliberately forgiving: a recipe should survive a button being renamed
      // rather than abandoning a 25-second recording over it.
      const el = await page.$(step.selector);
      if (el) await el.click({ timeout: 3000 }).catch(() => {});
      break;
    }

    case 'scroll':
      // Smooth, human-paced scrolling. A single jump reads as a cut, not a
      // scroll, and gives the viewer nothing to follow.
      await page.evaluate(({ by, overMs }) => new Promise(resolve => {
        const start = window.scrollY;
        const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / overMs);
          const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + by * eased);
          if (p < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      }), { by: step.by ?? 400, overMs: step.overMs ?? 2000 });
      break;

    case 'idle':
      // Let a game run untouched. Fine for menus and scroll-throughs; for a
      // game, prefer `play` — an idle arena reads as a screensaver.
      await page.waitForTimeout(step.ms ?? 5000);
      break;

    // Press a sequence of keys once, human-paced.
    //
    // Keyboard rather than clicking the on-screen controls: DPT's numpad fires
    // on pointerdown with a double-fire guard, so synthesising pointer events
    // means reproducing that timing exactly. Its key handler takes the same
    // commands and is what the UI itself dispatches through.
    case 'keys':
      for (const key of step.keys ?? []) {
        await page.keyboard.press(key);
        await page.waitForTimeout(step.keyGapMs ?? 140);
      }
      break;

    // Drive the game for a stretch, issuing real commands.
    //
    // This is what makes footage look played rather than merely running: an
    // untouched DPT arena is four aircraft drifting in straight lines, which is
    // exactly as dull on camera as it sounds.
    //
    // Commands are spelled out in the recipe rather than generated here. A
    // sequence like ['a','ArrowRight','0','9','0'] is reviewable as "select
    // CA-A, turn right, steer 090" by anyone who knows the game, and keeps this
    // runner free of per-game knowledge that would rot.
    case 'play': {
      const commands = step.commands ?? [];
      const until = Date.now() + (step.ms ?? 10000);
      let i = 0;

      while (Date.now() < until) {
        if (commands.length) {
          for (const key of commands[i % commands.length]) {
            await page.keyboard.press(key);
            await page.waitForTimeout(step.keyGapMs ?? 140);
          }
          i++;
        }
        // Pause between commands whether or not any were sent, so a recipe with
        // no commands degrades to an idle rather than spinning the CPU.
        await page.waitForTimeout(step.gapMs ?? 1800);
      }
      break;
    }

    // Play a game the way the landing wall's demo cards do — press the start
    // control, then keep pressing answer controls at a steady cadence.
    //
    // This is the generic counterpart to `play`. `play` sends real DPT bearing
    // commands and knows the game; this knows only [data-demo-answer] and
    // [data-demo-start], which is precisely why it works on every game that
    // carries them and needed no new per-game browser code to film twelve of
    // them. See src/components/landingGames/demoDriver.js for the original.
    //
    // intervalMs 0 means the game runs on its own clock (SAT, RTT, SMA): there
    // is nothing to press, so this degrades to an idle rather than poking at a
    // game that is already moving.
    case 'demoPlay': {
      const interval = step.intervalMs ?? 0;
      const totalMs = step.ms ?? 15000;

      if (!interval) { await page.waitForTimeout(totalMs); break; }

      const hand = ctx.hand;
      const rng = ctx.rng ?? Math.random;
      const until = Date.now() + totalMs;

      while (Date.now() < until) {
        const tickStart = Date.now();

        // Typed-answer games (ANT, Code Duplicates) keep Submit disabled until
        // the box has something in it, so a driver that only clicks films a
        // dead form. Still done in-page: this is filling a field, not pressing
        // a control, and there is nothing for a cursor to show.
        //
        // React tracks the value on the DOM node, so assigning to .value is
        // ignored on the next render. Going through the prototype setter and
        // dispatching 'input' is what makes React see it.
        await page.evaluate((sel) => {
          const box = Array.from(document.querySelectorAll(sel))
            .find(el => !el.disabled && !el.value);
          if (!box) return;
          const proto = box instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (!setter) return;
          setter.call(box, box.getAttribute('data-demo-input') || '1');
          box.dispatchEvent(new Event('input', { bubbles: true }));
        }, '[data-demo-input]').catch(() => {});

        // Measured on THIS tick, not once up front: controls mount and unmount
        // between questions, and a box captured a second ago may belong to an
        // element that has since gone.
        const targets = await collectTargets(page);
        if (targets.length === 0) { await page.waitForTimeout(interval); continue; }

        const digits = digitTargets(targets);

        // Ten enabled single-digit controls is a keypad with a live question -
        // FLAG disables its numpad until one is up (`disabled={!mathsActive}`),
        // and every other game with a keypad does the same. Answering it as a
        // run of digits is what reads as "somebody just answered that"; the
        // same presses spread across the cadence read as noise.
        if (digits.length >= 10) {
          const count = rng() < 0.55 ? 2 : 1;
          const picks = [];
          for (let d = 0; d < count; d++) {
            picks.push(digits[Math.floor(rng() * digits.length)].box);
          }
          await hand.typeDigits(picks).catch(() => {});
        } else {
          // An answer while play is running, otherwise whatever restarts it -
          // which is what stops a clip freezing on the first end-of-round
          // screen it reaches.
          const answers = targets.filter(t => t.role === 'answer');
          const pool = answers.length ? answers : targets;
          const pick = pool[Math.floor(rng() * pool.length)];

          const miss = pick.role === 'answer' && rng() < MISS_RATE;

          if (pool.length > 1 && rng() < HESITATE_RATE) {
            let decoy = pool[Math.floor(rng() * pool.length)];
            if (decoy === pick) decoy = pool[(pool.indexOf(pick) + 1) % pool.length];
            await hand.hesitateThenTap(decoy.box, pick.box, { miss }).catch(() => {});
          } else {
            await hand.tap(pick.box, { miss }).catch(() => {});
          }
        }

        // The cadence is what is left of the interval once the hand has done
        // its work, jittered so presses do not land on a metronome. Travel and
        // dwell already took time, so sleeping the full interval on top would
        // halve the number of moves a recording gets.
        const spent = Date.now() - tickStart;
        const wait = Math.max(0, between([interval * 0.6, interval * 1.25], rng) - spent);
        if (wait > 0) await page.waitForTimeout(wait);
      }
      break;
    }

    default:
      throw new Error(`Unknown capture step "${step.do}"`);
  }
}

module.exports = async function captureHandler({ job, progress }) {
  const { chromium } = require('playwright');

  const recipeId = job.payload?.recipeId;
  const recipe = getRecipe(recipeId);
  const targetUrl = baseUrl();
  assertSafeTarget(targetUrl);

  await progress(5, `launching browser for ${recipe.label}`);

  // GPU on: the CBAT games are WebGL, and software rendering turns them into a
  // slideshow (CLAUDE.md records an 86s software-rendered screenshot).
  const browser = await chromium.launch({
    headless: isHeadless(),
    args: ['--hide-scrollbars', '--mute-audio', '--disable-background-networking'],
  });

  const workDir = path.join(os.tmpdir(), 'skywatch-clipper', 'capture', String(job._id));
  const outPath = path.join(os.tmpdir(), 'skywatch-clipper', 'capture', `${job._id}.mp4`);

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      // deviceScaleFactor is deliberately 1: screencast ignores it, so raising
      // it only costs render time for pixels that are thrown away.
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      storageState: job.payload?.storageState || undefined,
    });
    await context.addInitScript(CURSOR_SCRIPT);

    const page = await context.newPage();

    // Sign in BEFORE recording starts, so the clip does not open on a login
    // form nobody wants to watch.
    if (recipe.requiresAuth) {
      await progress(8, 'signing in');
      await signIn(page);
    }

    await progress(12, 'starting recording');
    const rec = await record(page, {
      outPath, workDir,
      width: OUTPUT.width, height: OUTPUT.height,
    });

    await markDocument(page);

    // One hand for the whole recipe, so the pointer carries its position from
    // step to step. A fresh hand per step would snap back to the middle of the
    // screen before every press, which is the one movement a person never makes.
    //
    // Seeded from the job id: two recordings of the same recipe should not come
    // out frame-identical, but one that misbehaved should be reproducible.
    const inputLog = [];
    const seed = Number(String(job._id).replace(/[^0-9]/g, '').slice(-9)) || 1;
    const ctx = {
      inputLog,
      rng: makeRng(seed),
      viewport: VIEWPORT,
      startedAt: Date.now(),
    };
    ctx.hand = createHand(page, {
      rng: ctx.rng, startedAt: ctx.startedAt, viewport: VIEWPORT, log: inputLog,
    });

    // A reload mid-capture is not a small blemish: the app takes seconds to
    // boot and lands back on its first screen, so most of what follows is the
    // splash and the menu. One verified clip lost twenty-two of its thirty-six
    // seconds that way and still read as a successful capture in the job log.
    //
    // Checked around the whole recipe rather than only at the end, because a
    // reload usually surfaces first as some later step failing to find an
    // element — and "timed out waiting for the arena" sends you looking for a
    // selector change that never happened.
    try {
      for (let i = 0; i < recipe.steps.length; i++) {
        await progress(
          Math.round(15 + (i / recipe.steps.length) * 70),
          `${recipe.label}: step ${i + 1}/${recipe.steps.length}`,
        );
        await runStep(page, recipe.steps[i], progress, ctx);
      }
      if (!(await documentSurvived(page))) throw new Error(RELOADED);
    } catch (err) {
      if (err.message !== RELOADED && !(await documentSurvived(page))) {
        throw new Error(`${RELOADED} (surfaced as: ${err.message.split('\n')[0]})`);
      }
      throw err;
    }

    await progress(88, 'encoding');
    const result = await rec.stop();

    return {
      recipeId,
      label: recipe.label,
      localPath: result.path,
      bytes: result.bytes,
      frames: result.frames,
      fps: result.fps,
      // Straight from ffprobe. Reporting the intended size rather than the
      // real one is how a 432x768 capture was recorded as 1080x1920.
      width: result.width,
      height: result.height,
      durationSec: result.durationSec,
      // Where the hand actually went, as { atMs, x, y, kind } with x and y
      // normalised to the viewport. Kept so the EDIT can punch in on real input
      // rather than on a rect measured once by hand: buildTimeline turns these
      // into a focus rect for the shot they fall inside.
      //
      // Deliberately not baked into the recording. A zoom in the MP4 cannot be
      // undone, cannot be retuned, and would fight the Ken Burns move and the
      // phone frame that are applied at render time.
      inputLog,
    };
  } finally {
    await browser.close().catch(() => {});
  }
};
