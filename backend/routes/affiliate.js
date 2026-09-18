const router = require('express').Router();
const AffiliateClickCount = require('../models/AffiliateClickCount');

const hits = new Map();
const windowMs = 60_000;
const cleanup = setInterval(() => {
  for (const [ip, entry] of hits) if (Date.now() >= entry.until) hits.delete(ip);
}, windowMs);
cleanup.unref?.();

router.post('/click', async (req, res) => {
  const { item, store } = req.body || {};
  if (!['stick', 'pedals'].includes(item) || !['uk', 'ca'].includes(store)) {
    return res.status(400).json({ message: 'Invalid affiliate item or store' });
  }
  const ip = req.ip || 'unknown';
  let entry = hits.get(ip);
  if (!entry || Date.now() >= entry.until) {
    entry = { count: 0, until: Date.now() + windowMs };
    hits.set(ip, entry);
  }
  if (++entry.count > 30) return res.sendStatus(429);
  try {
    await AffiliateClickCount.updateOne(
      { _id: `${item}:${store}` },
      { $inc: { count: 1 } },
      { upsert: true },
    );
    return res.sendStatus(204);
  } catch (err) {
    console.error('Affiliate click record error:', err.message);
    return res.sendStatus(500);
  }
});

module.exports = router;
