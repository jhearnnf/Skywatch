const router = require('express').Router();

const { optionalAuth }  = require('../middleware/auth');
const DonationPageVisit = require('../models/DonationPageVisit');

/**
 * Arrival reporting for /donate.
 *
 * The donation funnel in the admin stats needs a denominator for the page —
 * "how many people were asked" — and /donate is the one ask that cannot report
 * its own impression against an account, because it is public and most of the
 * people who see it are not signed in. This endpoint is that report and nothing
 * else: it takes no amount, returns no data, and is never on the path of an
 * actual payment.
 *
 * `optionalAuth` for the same reason the Checkout endpoint uses it. A signed-in
 * visitor is recognised so their visits count once; everyone else is counted by
 * the random key their browser tab brought with it.
 */

// Cheap in-process throttle, matching routes/survey.js. This is a public write,
// so it gets a ceiling — but a stat endpoint is not worth durable machinery,
// and the write itself is an idempotent upsert on a key the caller chose, so
// the worst a flood achieves is a row it already had.
const HITS = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

function throttle(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const entry = HITS.get(ip);
  if (!entry || now > entry.resetAt) {
    HITS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (++entry.count > MAX_PER_WINDOW) {
    return res.status(429).json({ message: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// Keeps the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of HITS) if (now > e.resetAt) HITS.delete(ip);
}, 5 * 60 * 1000).unref?.();

// POST /api/donation/visit — "someone is looking at the donation page".
router.post('/visit', throttle, optionalAuth, async (req, res) => {
  try {
    const visitKey = DonationPageVisit.keyFor(req.user?._id, req.body?.visitKey);
    // A missing or malformed key is not an error worth showing anyone. The page
    // carries on regardless; only the stat loses a row.
    if (visitKey) await DonationPageVisit.record(visitKey, req.user?._id ?? null);
    res.json({ status: 'success' });
  } catch (err) {
    console.error('Donation visit record error:', err.message);
    res.json({ status: 'success' });
  }
});

module.exports = router;
