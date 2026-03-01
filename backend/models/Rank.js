const mongoose = require('mongoose');

const rankSchema = new mongoose.Schema({
  rankType: {
    type: String,
    enum: ['enlisted_aviator', 'non_commissioned_aircrew', 'commissioned_officer'],
    required: true,
  },
  rankNumber:       { type: Number, required: true },  // lower = more junior
  rankName:         { type: String, required: true, trim: true },
  rankAbbreviation: { type: String, required: true, trim: true },
  rankNotes:        { type: String, trim: true },
});

rankSchema.index({ rankNumber: 1 }, { unique: true });

module.exports = mongoose.model('Rank', rankSchema);
