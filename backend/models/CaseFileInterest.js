const mongoose = require('mongoose');

/**
 * CaseFileInterest — a player saying "I want the next one" (or taking it back)
 * from the "Coming up" teaser at the end of a chapter's debrief.
 *
 * One document per player per teaser, keyed by the chapter whose debrief shows
 * it. `interested` is kept rather than deleting the row on withdrawal: someone
 * who registers and then changes their mind is a signal too.
 */
const caseFileInterestSchema = new mongoose.Schema(
  {
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    caseSlug:    { type: String, required: true },
    // The chapter the teaser sits at the end of, not the chapter it teases:
    // the next chapter usually does not exist yet, which is the point.
    chapterSlug: { type: String, required: true },
    // Copied from the teaser at the time, so the admin tally still reads
    // sensibly if the teaser copy is edited later.
    teaserTitle: { type: String, default: '' },
    interested:  { type: Boolean, required: true },
  },
  { timestamps: true }
);

caseFileInterestSchema.index({ userId: 1, caseSlug: 1, chapterSlug: 1 }, { unique: true });
caseFileInterestSchema.index({ caseSlug: 1, chapterSlug: 1 });

module.exports = mongoose.model('CaseFileInterest', caseFileInterestSchema);
