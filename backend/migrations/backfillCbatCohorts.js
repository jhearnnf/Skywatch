'use strict';

const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');

module.exports = async function backfillCbatCohorts() {
  const users = await User.find({
    cbatDate: { $ne: null }, upcomingCbatDate: null, upcomingCbatDateRemovedAt: null,
    $or: [{ firstSeenCountry: { $type: 'string' } }, { 'geo.country': { $type: 'string' } }],
  }).select('cbatDate firstSeenCountry geo.country').lean();

  let imported = 0;
  for (const user of users) {
    const region = String(user.firstSeenCountry || user.geo?.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) continue;
    const date = new Date(user.cbatDate).toISOString().slice(0, 10);
    const cohortKey = `${date}:${region}`;
    const readableDate = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00.000Z`));
    await ChatConversation.findOneAndUpdate(
      { type: 'channel', 'channel.cohortKey': cohortKey },
      { $setOnInsert: { type: 'channel', isArchived: false, channel: {
        name: `CBAT · ${readableDate}`, slug: `cbat-${date}-${region.toLowerCase()}`,
        description: 'Private chat for applicants attending CBAT on the same date in the same region.',
        emoji: '✈️', order: 3, postPolicy: 'everyone', notifyMembers: false,
        audience: 'cbat-cohort', cohortKey, cohortDate: date, cohortRegion: region,
      } } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    const result = await User.updateOne(
      { _id: user._id, upcomingCbatDate: null, upcomingCbatDateRemovedAt: null },
      { $set: { upcomingCbatDate: user.cbatDate, upcomingCbatRegion: region, upcomingCbatDateLockedAt: new Date() } },
    );
    imported += result.modifiedCount;
  }
  return { imported };
};
