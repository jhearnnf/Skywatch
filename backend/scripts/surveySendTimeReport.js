'use strict';

/**
 * Which send time gets the most questionnaire replies? Read-only.
 *
 *   node scripts/surveySendTimeReport.js              # every send since 2026-09-06
 *   node scripts/surveySendTimeReport.js --auto       # only the rotating auto-sends
 *   node scripts/surveySendTimeReport.js --since 2026-11-17
 *
 * Counts per send, not per person. The unit is one EmailLog 'cbat_survey' row
 * (an email that actually went out), because SurveyInvite.sentAt is overwritten
 * by a follow-up and would credit an earlier send to the later one's hour.
 *
 * A send "got a reply" when the invite's link was first opened after that send
 * and before the next one to the same person (so a follow-up's reply is not
 * also credited to the original). "Same hour" means the link was opened within
 * an hour of the email arriving: the share that send time can actually move.
 *
 * Default start date skips the 2026-09-03 localhost batch and its 09-04/05
 * apology resends, which would swamp the morning and late buckets.
 */

require('dotenv').config();
const mongoose     = require('mongoose');
const EmailLog     = require('../models/EmailLog');
const SurveyInvite = require('../models/SurveyInvite');
const { ACTIVITY_TZ } = require('../constants/activity');
const { SURVEY_CAMPAIGN, SURVEY_AUTO_SEND_HOURS_UK } = require('../constants/survey');

const args  = process.argv.slice(2);
const AUTO  = args.includes('--auto');
const sinceArg = args[args.indexOf('--since') + 1];
const SINCE = new Date(args.includes('--since') ? sinceArg : '2026-09-06');
const HOUR  = 60 * 60 * 1000;

const ukHour = (d) => +new Intl.DateTimeFormat('en-GB', { timeZone: ACTIVITY_TZ, hour: '2-digit', hourCycle: 'h23' }).format(d);
const ukDay  = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: ACTIVITY_TZ, weekday: 'short' }).format(d);

// Manual sends happen at any hour; file each under the rotation slot it is
// closest to so the two kinds of send land in the same buckets.
function slotFor(log) {
  if (Number.isInteger(log.metadata?.slotHour)) return log.metadata.slotHour;
  const h = ukHour(log.sentAt);
  const dist = (s) => Math.min(Math.abs(h - s), 24 - Math.abs(h - s));
  return SURVEY_AUTO_SEND_HOURS_UK.reduce((best, s) => (dist(s) < dist(best) ? s : best));
}

function row(label, b) {
  const pct = (n) => (b.sent ? `${Math.round((100 * n) / b.sent)}%` : '-').padStart(5);
  return `${label.padEnd(10)} ${String(b.sent).padStart(5)} ${String(b.opened).padStart(7)} ${pct(b.opened)} ${String(b.sameHour).padStart(9)} ${pct(b.sameHour)} ${String(b.completed).padStart(9)}`;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const query = { type: 'cbat_survey', status: 'sent', sentAt: { $gte: SINCE }, 'metadata.campaign': SURVEY_CAMPAIGN };
  if (AUTO) query['metadata.source'] = 'auto';
  const logs = await EmailLog.find(query).sort({ sentAt: 1 }).lean();
  const invites = await SurveyInvite.find({ campaign: SURVEY_CAMPAIGN, isTest: { $ne: true } })
    .select('userId openedAt completedAt').lean();
  const inviteByUser = new Map(invites.map(i => [String(i.userId), i]));

  // Every send to each person, in order, so a reply is credited to the send
  // that came right before it. Uses every send (not just the filtered ones).
  const allSends = await EmailLog.find({ type: 'cbat_survey', status: 'sent', 'metadata.campaign': SURVEY_CAMPAIGN })
    .select('recipientUserId sentAt').sort({ sentAt: 1 }).lean();
  const sendsByUser = new Map();
  for (const s of allSends) {
    const k = String(s.recipientUserId);
    if (!sendsByUser.has(k)) sendsByUser.set(k, []);
    sendsByUser.get(k).push(s.sentAt);
  }

  const empty = () => ({ sent: 0, opened: 0, sameHour: 0, completed: 0 });
  const bySlot = new Map(SURVEY_AUTO_SEND_HOURS_UK.map(h => [h, empty()]));
  const byDay  = new Map();
  const total  = empty();

  for (const log of logs) {
    const invite = inviteByUser.get(String(log.recipientUserId));
    if (!invite) continue; // a test send, or an erased account
    const later = (sendsByUser.get(String(log.recipientUserId)) || []).find(t => t > log.sentAt);
    const opened = invite.openedAt && invite.openedAt >= log.sentAt && (!later || invite.openedAt < later);
    const outcome = {
      sent: 1,
      opened: opened ? 1 : 0,
      sameHour: opened && invite.openedAt - log.sentAt <= HOUR ? 1 : 0,
      completed: opened && invite.completedAt ? 1 : 0,
    };
    const day = ukDay(log.sentAt);
    if (!byDay.has(day)) byDay.set(day, empty());
    for (const b of [bySlot.get(slotFor(log)), byDay.get(day), total]) {
      for (const k of Object.keys(outcome)) b[k] += outcome[k];
    }
  }

  const header = `${''.padEnd(10)} ${'sent'.padStart(5)} ${'opened'.padStart(7)} ${''.padStart(5)} ${'same hour'.padStart(9)} ${''.padStart(5)} ${'completed'.padStart(9)}`;
  console.log(`Questionnaire sends since ${SINCE.toISOString().slice(0, 10)}${AUTO ? ' (auto-sends only)' : ''}\n`);
  console.log('By send slot (UK time; manual sends filed under the nearest slot)');
  console.log(header);
  for (const [h, b] of bySlot) console.log(row(`${String(h).padStart(2, '0')}:00`, b));
  console.log(row('all', total));

  console.log('\nBy weekday sent');
  console.log(header);
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) if (byDay.has(d)) console.log(row(d, byDay.get(d)));

  console.log('\nSmall numbers: a gap of a few points between slots is noise until each slot has ~100 sends.');
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
