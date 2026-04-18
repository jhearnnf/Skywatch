const mongoose = require('mongoose');

const levelSchema = new mongoose.Schema({
  levelNumber: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 10,
  },
  // Airstars required to advance to the next level (null = max level reached)
  airstarsToNextLevel: {
    type: Number,
    default: null,
  },
});

// Seed levels 1–10 on first startup if they don't exist
levelSchema.statics.seedLevels = async function () {
  const count = await this.countDocuments();
  if (count >= 10) return;

  // Exponential-style curve: increments grow by ~100–150 each step
  // Cumulative totals: 0, 100, 350, 850, 1700, 3000, 4850, 7350, 10600, 14700
  const levels = [
    { levelNumber: 1,  airstarsToNextLevel: 100  },
    { levelNumber: 2,  airstarsToNextLevel: 250  },
    { levelNumber: 3,  airstarsToNextLevel: 500  },
    { levelNumber: 4,  airstarsToNextLevel: 850  },
    { levelNumber: 5,  airstarsToNextLevel: 1300 },
    { levelNumber: 6,  airstarsToNextLevel: 1850 },
    { levelNumber: 7,  airstarsToNextLevel: 2500 },
    { levelNumber: 8,  airstarsToNextLevel: 3250 },
    { levelNumber: 9,  airstarsToNextLevel: 4100 },
    { levelNumber: 10, airstarsToNextLevel: null  },
  ];

  await this.insertMany(levels);
  console.log('Levels seeded');
};

module.exports = mongoose.model('Level', levelSchema);
