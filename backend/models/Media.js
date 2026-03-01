const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  mediaType: { type: String, enum: ['picture', 'video'], required: true },
  mediaUrl:  { type: String, required: true, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('Media', mediaSchema);
