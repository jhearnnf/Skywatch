const mongoose = require('mongoose');

const levelSchema = new mongoose.Schema({
  levelNumber: {
    type: Number,
    required: true,
    unique: true,
    min: 1,
    max: 10,
  },
  // Aircoins required to advance to the next level (null = max level reached)
  aircoinsToNextLevel: {
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
    { levelNumber: 1,  aircoinsToNextLevel: 100  },
    { levelNumber: 2,  aircoinsToNextLevel: 250  },
    { levelNumber: 3,  aircoinsToNextLevel: 500  },
    { levelNumber: 4,  aircoinsToNextLevel: 850  },
    { levelNumber: 5,  aircoinsToNextLevel: 1300 },
    { levelNumber: 6,  aircoinsToNextLevel: 1850 },
    { levelNumber: 7,  aircoinsToNextLevel: 2500 },
    { levelNumber: 8,  aircoinsToNextLevel: 3250 },
    { levelNumber: 9,  aircoinsToNextLevel: 4100 },
    { levelNumber: 10, aircoinsToNextLevel: null  },
  ];

  await this.insertMany(levels);
  console.log('Levels seeded');
};

module.exports = mongoose.model('Level', levelSchema);
