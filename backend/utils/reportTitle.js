// A short title for a support ticket, so the Community rail and the admin
// queue can say "Instruments needles drawn off the dial" instead of quoting
// the first eighty characters of whatever was typed.
//
// Generated once, just after the ticket opens, and stored on its thread and,
// when it came from a problem report, on the report too. Fire-and-forget from
// the route: nobody waits on a model round trip, and until it lands (or if it
// never does) the ticket carries an excerpt of its opening message instead,
// so a failure here costs nothing but polish.
//
// Same gateway as every other model call in this backend (utils/openRouter.js)
// so the spend lands on the usage page under its own feature name.

const ProblemReport    = require('../models/ProblemReport');
const ChatConversation = require('../models/ChatConversation');
const { callOpenRouter } = require('./openRouter');

// A one-line title needs no more than the small model.
const MODEL = 'anthropic/claude-haiku-4-5';
const FEATURE = 'report-title';
const MAX_TITLE = 60;
const TIMEOUT_MS = 12_000;

const SYSTEM =
  'You write one-line titles for support tickets opened by users of a web app called SkyWatch, ' +
  'which has practice versions of aircrew aptitude tests (called CBAT games), a chat, briefs and a profile. ' +
  'A ticket is a bug report or a question to the team. Given the opening message and, when known, the page ' +
  'it was sent from, reply with ONLY a title: at most eight words, sentence case, plain English, naming ' +
  'the feature and the problem or question, no quotes, no trailing full stop, no markdown, no em dashes. ' +
  'If the message is not a real problem or question (a test, a greeting, nonsense), reply with a plain ' +
  'description of it, such as "Test message" or "Greeting with no question".';

// The title a ticket carries until the model's lands: the opening of what
// was typed, cut to fit. Also the permanent title when there is no key.
const EXCERPT_LEN = 80;
function excerptTitle(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > EXCERPT_LEN ? `${s.slice(0, EXCERPT_LEN - 1).trimEnd()}…` : s;
}

function cleanTitle(raw) {
  let s = String(raw ?? '').split('\n')[0].trim();
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > MAX_TITLE) s = `${s.slice(0, MAX_TITLE - 1).trimEnd()}…`;
  return s;
}

// Resolves to a title string, or null when there is no key, the model answers
// with nothing usable, or the call fails. Never throws.
async function generateReportTitle({ description, pageReported }) {
  if (!process.env.OPENROUTER_KEY) return null;
  const text = String(description ?? '').trim();
  if (!text) return null;
  try {
    const from = pageReported ? `Sent from: ${pageReported}\n\n` : '';
    const call = callOpenRouter({
      key: 'main',
      feature: FEATURE,
      body: {
        model: MODEL,
        max_tokens: 40,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `${from}Message:\n${text.slice(0, 2000)}` },
        ],
      },
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('report title timed out')), TIMEOUT_MS));
    const data = await Promise.race([call, timeout]);
    return cleanTitle(data?.choices?.[0]?.message?.content);
  } catch (err) {
    console.error('[reportTitle] failed:', err.message);
    return null;
  }
}

// Fire-and-forget: generate and store on the ticket's thread and, when it
// came from a report, on the report too. Tracked so tests can await the write.
const pending = new Set();

function scheduleTicketTitle({ conversationId = null, reportId = null, description, pageReported = null }) {
  const p = (async () => {
    const title = await generateReportTitle({ description, pageReported });
    if (!title) return;
    await Promise.all([
      conversationId ? ChatConversation.updateOne({ _id: conversationId }, { $set: { title } }) : null,
      reportId       ? ProblemReport.updateOne({ _id: reportId }, { $set: { title } })           : null,
    ]);
  })().catch(err => console.error('[reportTitle] failed to store:', err.message));
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
}

// A report on its own (the backfill script): titles it and its thread.
function scheduleReportTitle(report) {
  return scheduleTicketTitle({
    conversationId: report.conversationId ?? null,
    reportId: report._id,
    description: report.description,
    pageReported: report.pageReported,
  });
}

async function _flushPendingTitles() {
  while (pending.size) await Promise.allSettled([...pending]);
}

module.exports = {
  generateReportTitle, scheduleReportTitle, scheduleTicketTitle, cleanTitle, excerptTitle,
  _flushPendingTitles, MAX_TITLE,
};
