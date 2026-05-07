require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');

const app = express();

// Stripe webhook needs raw body — must be registered BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:4173',
  'https://localhost',       // Capacitor Android WebView
  'capacitor://localhost',   // Capacitor Android scheme
].filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/briefs',     require('./routes/briefs'));
app.use('/api/case-files', require('./routes/caseFiles'));
app.use('/api/games',      require('./routes/games'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/users',  require('./routes/users'));
app.use('/api/chat',   require('./routes/chat'));
app.use('/api/tutorials', require('./routes/tutorials'));
app.use('/api/stripe',        require('./routes/stripe'));
app.use('/api/aptitude-sync', require('./routes/aptitudeSync'));
app.use('/api/admin/social', require('./routes/social'));

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
