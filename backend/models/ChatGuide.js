const mongoose = require('mongoose');

// A link in the Community rail's Guides section: somewhere off-site worth
// reading about CBAT.
//
// Not a ChatConversation. A guide has no messages, no unread state and nothing
// to moderate — it is a bookmark the SkyWatch team curates, so folding it into
// the conversation model would mean every conversation query carried rows that
// are not conversations.
//
// `url` is admin-entered and rendered as a real anchor, so the route validates
// it to http/https before it is ever stored — see assertSafeUrl in routes/chat.js.
const schema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true, maxlength: 60 },
  url:         { type: String, required: true, trim: true, maxlength: 500 },
  description: { type: String, default: '', trim: true, maxlength: 200 },
  emoji:       { type: String, default: null },
  // Lower shows first; ties fall back to title so the order is never arbitrary.
  order:       { type: Number, default: 0 },
  // Hidden guides stay in the console but drop out of the rail — for a link
  // that has gone stale but is worth keeping the URL of.
  isHidden:    { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

schema.index({ isHidden: 1, order: 1, title: 1 });

module.exports = mongoose.model('ChatGuide', schema);
