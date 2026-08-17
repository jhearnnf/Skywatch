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
    // Reconcile User.displayNameLower index — drops legacy non-partial
    // unique index that caused E11000 on null when a second user registered.
    await require('./migrations/syncUserDisplayNameIndex')();
    // Split legacy GameSessionCbatStart docs (gameKey:'plane-turn') into
    // 'plane-turn-2d' to match the registry split. Idempotent.
    await require('./migrations/splitPlaneTurnStarts')({ db: mongoose.connection.db });
    // Move chat to the three-type model (support/dm/channel): backfill type,
    // replace the legacy open-chat unique index whose filter lacked `type`,
    // and seed a starting channel on a database that has none. Idempotent.
    await require('./migrations/chatChannelsUpgrade')();
    // One-shot repair of medal messages posted while agentLabel() escaped
    // markdown for Discord, which the plain-text chat feed showed literally.
    await require('./migrations/unescapeMedalMessages')();
    // Name the difficulty on medal messages posted before both halves of a
    // split game were qualified ("FLAG" → "FLAG (Hard)"). Idempotent.
    await require('./migrations/labelMedalDifficulty')();
    // The guide bot's account. Idempotent; see seeds/seedChatBot.js.
    await require('./seeds/seedChatBot')();
    // The CBAT guide's row in Community › Guides. Runs once ever.
    await require('./seeds/seedChatGuides')();
    // The room behind the mini chat on the CBAT hub. Runs once ever.
    await require('./seeds/seedCbatLounge')();
    // Add the clientResultId path/index to CBAT result schemas so offline score
    // submissions can be deduplicated on flush retries.
    require('./utils/cbatResult').ensureCbatResultPaths();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
