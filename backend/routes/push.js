// Push notification devices. WHAT a user hears about is PATCH
// /api/users/me/push-prefs; this router only signs a device up and takes it
// off again. See utils/pushNotify.js for delivery.

const router = require('express').Router();
const { protect } = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');
const { publicConfig } = require('../utils/pushNotify');

router.use(protect);

const MAX_ENDPOINT = 2048;
const MAX_KEY      = 256;

// GET /api/push/config — what this server can deliver. `webPublicKey` is the
// VAPID key a browser subscribes with; null means web push is not set up on
// this server and the client should not offer it. `fcm` is the same for the
// Android app.
router.get('/config', (_req, res) => {
  res.json({ status: 'success', data: publicConfig() });
});

// Pull the device address out of either request shape, or null if it is bad.
//   web: { kind: 'web', subscription: { endpoint, keys: { p256dh, auth } } }
//   fcm: { kind: 'fcm', token }
function parseDevice(body) {
  const kind = body?.kind;
  if (kind === 'web') {
    const sub = body.subscription ?? {};
    const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth   = typeof sub.keys?.auth   === 'string' ? sub.keys.auth   : '';
    // Only ever an https push service URL: the server POSTs to whatever is
    // stored here, so it must not be a way to make it call anywhere else.
    if (!/^https:\/\//.test(endpoint) || endpoint.length > MAX_ENDPOINT) return null;
    if (!p256dh || !auth || p256dh.length > MAX_KEY || auth.length > MAX_KEY) return null;
    return { kind, endpoint, keys: { p256dh, auth } };
  }
  if (kind === 'fcm') {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > MAX_ENDPOINT) return null;
    return { kind, endpoint: token };
  }
  return null;
}

// POST /api/push/subscribe — sign this device up (or refresh it). Upserts on
// the address, so a phone that moves between accounts ends up on the account
// now signed in rather than notifying both.
router.post('/subscribe', async (req, res) => {
  try {
    const device = parseDevice(req.body);
    if (!device) return res.status(400).json({ status: 'error', message: 'Invalid push subscription' });
    const platform = typeof req.body.platform === 'string' ? req.body.platform.slice(0, 20) : null;

    await PushSubscription.findOneAndUpdate(
      { endpoint: device.endpoint },
      {
        $set: {
          userId: req.user._id,
          kind:   device.kind,
          ...(device.keys ? { keys: device.keys } : {}),
          platform,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true },
    );
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/push/unsubscribe { endpoint } — take this device off. Scoped to
// the caller's own rows. Also called on sign out, so a shared device stops
// showing the last person's messages.
router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint) return res.status(400).json({ status: 'error', message: 'endpoint is required' });
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id });
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
