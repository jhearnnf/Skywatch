'use strict';

/**
 * Find every questionnaire email that went out with a link the recipient could
 * not open, and flag its invite so the person is owed a working one.
 *
 *   node scripts/flagBrokenSurveyLinks.js            # dry run, changes nothing
 *   node scripts/flagBrokenSurveyLinks.js --apply    # writes brokenLinkAt
 *
 * WHY IT ASKS RESEND RATHER THAN GUESSING
 *
 * Nothing in our own database records the base URL an email was built with —
 * EmailLog stores the subject, not the body. So "which sends were broken?"
 * cannot be answered from the DB at all, and a guess ("everything in that
 * batch") would be a guess about who to email a second time. Resend keeps the
 * delivered HTML, so the actual link in the actual message is checked, and an
 * invite is flagged only when its own token is found inside a non-public URL.
 *
 * That also makes the script safe to re-run and safe to run in future: it will
 * find nothing once the guard in utils/surveyEmail.js has been in place for a
 * campaign, and it stays useful the day some other misconfiguration does the
 * same thing again.
 */

require('dotenv').config();
const mongoose     = require('mongoose');
const SurveyInvite = require('../models/SurveyInvite');

const APPLY = process.argv.includes('--apply');
const KEY   = process.env.RESEND_API_KEY;

// The link is fine only if it is https and not pointed at somebody's laptop.
function isDeadLink(url) {
  try {
    const u = new URL(url);
    return u.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname);
  } catch {
    return true;
  }
}

// Resend stamps "2026-09-03 09:49:21.753000+00", which Date cannot read: the
// space needs to be a T and a two-digit offset needs its minutes. Falls back to
// the invite's own sentAt rather than writing an Invalid Date into the flag.
function parseResendDate(raw, fallback = new Date()) {
  const iso = String(raw ?? '').replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

async function resend(path) {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`Resend ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  if (!KEY) throw new Error('RESEND_API_KEY is not set — cannot read what was actually delivered.');
  await mongoose.connect(process.env.MONGODB_URI);

  // Every invite that has been mailed at least once, keyed by its token: the
  // token is what ties a delivered message back to a person.
  const invites = await SurveyInvite.find({ sentAt: { $ne: null } }).lean();
  const byToken = new Map(invites.map(i => [i.token, i]));
  console.log(`${invites.length} sent invitations to check.`);

  const list = await resend('/emails?limit=100');
  const rows = list.data ?? [];
  console.log(`${rows.length} messages in the Resend log.`);

  const broken = [];
  for (const row of rows) {
    const mail = await resend(`/emails/${row.id}`); // eslint-disable-line no-await-in-loop
    const html = mail.html ?? '';
    const links = [...html.matchAll(/https?:\/\/[^"'<>\s]+\/survey\/([0-9a-f]{64})/g)];
    if (!links.length) continue;

    const [url, token] = [links[0][0], links[0][1]];
    const invite = byToken.get(token);
    if (!invite) continue;                  // a test-campaign invite that has since been replaced
    if (!isDeadLink(url)) continue;         // this one was fine
    if (invite.completedAt) continue;       // they answered anyway; nothing owed
    if (invite.optedOutAt) continue;        // they asked us to stop; do not re-mail

    broken.push({ invite, to: row.to?.[0], at: parseResendDate(row.created_at, invite.sentAt), url: url.split('/survey/')[0] });
  }

  broken.sort((a, b) => a.at - b.at);
  console.log(`\n${broken.length} delivered emails carried an unusable link:\n`);
  broken.forEach(b => console.log(`  ${b.at.toISOString()}  ${b.to}  →  ${b.url}`));

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to flag these invitations for resending.');
  } else {
    await Promise.all(broken.map(b =>
      SurveyInvite.updateOne({ _id: b.invite._id }, { $set: { brokenLinkAt: b.at } }),
    ));
    console.log(`\nFlagged ${broken.length} invitations. They are now listed as needing a resend.`);
  }

  await mongoose.disconnect();
})().catch(err => { console.error(err.message); process.exit(1); });
