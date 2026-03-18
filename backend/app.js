require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean)

console.log('CORS allowed origins:', allowedOrigins)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use('/api/auth',   require('./routes/auth'));
app.use('/api/briefs', require('./routes/briefs'));
app.use('/api/games',  require('./routes/games'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/users',  require('./routes/users'));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/settings', async (_req, res) => {
  try {
    const s = await require('./models/AppSettings').getSettings();
    const { _id, __v, _singleton, ...pub } = s.toObject();
    res.json(pub);
  } catch {
    res.json({ volumeIntelBriefOpened: 100, volumeTargetLocked: 100, volumeOutOfAmmo: 100, freeCategories: ['News'], silverCategories: [] });
  }
});

module.exports = app;
