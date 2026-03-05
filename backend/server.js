require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth',   require('./routes/auth'));
app.use('/api/briefs', require('./routes/briefs'));
app.use('/api/games',  require('./routes/games'));
app.use('/api/admin',  require('./routes/admin'));
app.use('/api/users',  require('./routes/users'));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// Public: expose only the fields the frontend needs (sound volumes)
app.get('/api/settings', async (_req, res) => {
  try {
    const s = await require('./models/AppSettings').getSettings()
    res.json({
      volumeIntelBriefOpened: s.volumeIntelBriefOpened,
      volumeTargetLocked:     s.volumeTargetLocked,
      volumeOutOfAmmo:        s.volumeOutOfAmmo,
      freeCategories:         s.freeCategories,
      silverCategories:       s.silverCategories,
    })
  } catch {
    res.json({ volumeIntelBriefOpened: 100, volumeTargetLocked: 100, volumeOutOfAmmo: 100, freeCategories: ['News'], silverCategories: [] })
  }
});

async function seedGameTypes() {
  const GameType = require('./models/GameType');
  await GameType.findOneAndUpdate(
    { gameTitle: 'quiz' },
    { $setOnInsert: {
        gameTitle: 'quiz',
        allowedCategories: ['News','Aircrafts','Bases','Ranks','Squadrons','Training','Threats','Allies','Missions','AOR','Tech','Terminology','Treaties'],
        tutorialSteps: [],
        gameDescription: 'Answer multiple choice questions about the brief',
        awardedAircoins: 10,
    }},
    { upsert: true }
  );
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await require('./models/Level').seedLevels();
    await require('./seeds/seedRanks')();
    await require('./seeds/seedBriefs')();
    await require('./models/Media').ensurePlaceholderForBriefs();
    await seedGameTypes();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
