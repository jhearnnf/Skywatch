require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');
const { recordRejectedOrigin } = require('./utils/rejectedOriginLog');

const app = express();

// Stripe webhook needs raw body — must be registered BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

// Both the apex and www are listed explicitly. Vercel serves the site on both
// and does not redirect between them, so a user who arrives on www is on a
// different origin to one who arrives on the apex — different storage, and
// previously a completely broken (but normal-looking) site. CLIENT_URL stays
// first so a deploy can still point somewhere else without a code change.
const allowedOrigins = new Set([
  process.env.CLIENT_URL,
  'https://skywatch.academy',
  'https://www.skywatch.academy',
  'http://localhost:5173',
  'http://localhost:4173',
  'https://localhost',       // Capacitor Android WebView
  'capacitor://localhost',   // Capacitor Android scheme
].filter(Boolean))

// Gate disallowed origins *before* cors() rather than inside its callback.
// Throwing from that callback produced a 500 with no CORS headers, which is
// both wrong (it isn't a server fault) and unloggable. Here we answer with a
// clean 403 and, more importantly, leave a record — see rejectedOriginLog.js
// for why the server is the only place this failure can be observed.
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (!origin || allowedOrigins.has(origin)) return next()
  recordRejectedOrigin(origin, req)
  return res.status(403).json({ message: 'Origin not allowed' })
});

// Everything reaching here has an allowed origin (or none at all, e.g. curl and
// server-to-server callers), so reflecting it is safe. The gate above is the
// authority on what's permitted — don't duplicate the list here.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/briefs',     require('./routes/briefs'));
app.use('/api/case-files', require('./routes/caseFiles'));
app.use('/api/games',      require('./routes/games'));
app.use('/api/admin/reports', require('./routes/adminReports'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/users',  require('./routes/users'));
app.use('/api/chat',   require('./routes/chat'));
app.use('/api/tutorials', require('./routes/tutorials'));
app.use('/api/stripe',        require('./routes/stripe'));
app.use('/api/aptitude-sync', require('./routes/aptitudeSync'));
app.use('/api/admin/social', require('./routes/social'));
app.use('/api/brief-reels',   require('./routes/briefReels'));
app.use('/api/update-notifications', require('./routes/updateNotifications'));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/settings', async (_req, res) => {
  const s = await require('./models/AppSettings').getSettings();
  const { _id, __v, _singleton, ...pub } = s.toObject();
  res.json(pub);
});

app.use((_req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error',
  });
});

module.exports = app;
