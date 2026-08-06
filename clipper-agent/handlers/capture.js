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
  await page.click('text=Sign In with Email', { timeout: 10000 });
  await page.waitForSelector('#email', { timeout: 10000 });

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

async function runStep(page, step, progress) {
  switch (step.do) {
    case 'goto':
      await page.goto(`${baseUrl()}${step.path}`, { waitUntil: 'domcontentloaded' });
      break;

    case 'wait':
      await page.waitForTimeout(step.ms ?? 500);
      break;

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
      // Let a game run. We do not try to play well — the footage is the point,
      // and a bot chasing a good score would need game-specific logic that
      // breaks every time the game changes.
      await page.waitForTimeout(step.ms ?? 5000);
      break;

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

    for (let i = 0; i < recipe.steps.length; i++) {
      await progress(
        Math.round(15 + (i / recipe.steps.length) * 70),
        `${recipe.label}: step ${i + 1}/${recipe.steps.length}`,
      );
      await runStep(page, recipe.steps[i], progress);
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
    };
  } finally {
    await browser.close().catch(() => {});
  }
};
