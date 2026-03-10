/**
 * One-time migration: move legacy `description` string into `descriptionSections[0]`.
 * Safe to run repeatedly — skips any brief that already has descriptionSections populated.
 */
const mongoose = require('mongoose');

module.exports = async function migrateDescriptionSections() {
  const collection = mongoose.connection.collection('intelligencebriefs');

  const result = await collection.updateMany(
    {
      description: { $exists: true, $ne: null, $ne: '' },
      $or: [
        { descriptionSections: { $exists: false } },
        { descriptionSections: { $size: 0 } },
      ],
    },
    [
      { $set: { descriptionSections: ['$description'] } },
    ]
  );

  if (result.modifiedCount > 0) {
    console.log(`[migration] Migrated ${result.modifiedCount} brief(s): description → descriptionSections[0]`);
  }
};
