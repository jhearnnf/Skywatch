const mongoose = require('mongoose');

// Four aggregate counters; no visitor identifiers or browsing history stored.
const schema = new mongoose.Schema({
  _id: { type: String, enum: ['stick:uk', 'stick:ca', 'pedals:uk', 'pedals:ca'] },
  count: { type: Number, default: 0 },
});

module.exports = mongoose.model('AffiliateClickCount', schema);
