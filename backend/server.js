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
    await require('./migrations/migrateDescriptionSections')();
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
