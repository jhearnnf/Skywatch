const mongoose = require('mongoose');
const app      = require('./app');

async function seedGameTypes() {
  const GameType = require('./models/GameType');
  await GameType.findOneAndUpdate(
    { gameTitle: 'quiz' },
    { $setOnInsert: {
        gameTitle: 'quiz',
        allowedCategories: ['News','Aircrafts','Bases','Ranks','Squadrons','Training','Threats','Allies','Missions','AOR','Tech','Terminology','Treaties'],
        tutorialSteps: [],
        gameDescription: 'Answer multiple choice questions about the brief',
        awardedAirstars: 10,
    }},
    { upsert: true }
  );
}

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await require('./models/Level').seedLevels();
    await require('./models/Tutorial').seedDefaults();
    await require('./seeds/seedRanks')();
    await require('./seeds/seedBriefs')();
await require('./models/Media').ensurePlaceholderForBriefs();
    await seedGameTypes();
    await require('./seeds/caseFiles')();
    // One-shot reversal of legacy Case File airstar awards. Idempotent.
    await require('./migrations/reverseCaseFileAirstars')();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
