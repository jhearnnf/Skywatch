const mongoose = require('mongoose');
const { RANK_TYPES } = require('../constants/rankTypes');

const rankSchema = new mongoose.Schema({
  rankType: {
    type: String,
    enum: RANK_TYPES,
    required: true,
  },
  rankNumber:       { type: Number, required: true },  // lower = more junior
  rankName:         { type: String, required: true, trim: true },
  rankAbbreviation: { type: String, required: true, trim: true },
  rankNotes:        { type: String, trim: true },
});

rankSchema.index({ rankNumber: 1 }, { unique: true });

module.exports = mongoose.model('Rank', rankSchema);
