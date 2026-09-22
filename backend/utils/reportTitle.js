// A short title for a problem report, so the Community rail and the admin
// queue can say "Instruments needles drawn off the dial" instead of quoting
// the first eighty characters of whatever the reporter typed.
//
// Generated once, just after the report is filed, and stored on the report.
// Fire-and-forget from the route: the reporter's "Report submitted" must not
// wait on a model round trip, and a report with no title falls back to an
// excerpt of its description everywhere it is shown (utils/reportTickets.js,
// Admin.jsx), so a failure here costs nothing but polish.
//
// Same gateway as every other model call in this backend (utils/openRouter.js)
// so the spend lands on the usage page under its own feature name.

const ProblemReport = require('../models/ProblemReport');
const { callOpenRouter } = require('./openRouter');

// A one-line title needs no more than the small model.
const MODEL = 'anthropic/claude-haiku-4-5';
const FEATURE = 'report-title';
const MAX_TITLE = 60;
const TIMEOUT_MS = 12_000;

const SYSTEM =
  'You write one-line titles for bug reports filed by users of a web app called SkyWatch, ' +
  'which has practice versions of aircrew aptitude tests (called CBAT games), a chat, briefs and a profile. ' +
  'Given the report and the page it was filed from, reply with ONLY a title: ' +
  'at most eight words, sentence case, plain English, naming the feature and the fault, ' +
  'no quotes, no trailing full stop, no markdown, no em dashes. ' +
  'If the report is not a real problem (a test, a greeting, nonsense), reply with a plain description of it, ' +
  'such as "Test report" or "Message with no problem described".';

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
    const call = callOpenRouter({
      key: 'main',
      feature: FEATURE,
      body: {
        model: MODEL,
        max_tokens: 40,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Filed from: ${pageReported || 'unknown'}\n\nReport:\n${text.slice(0, 2000)}` },
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

// Fire-and-forget: generate and store, tracked so tests can await the write.
const pending = new Set();

function scheduleReportTitle(report) {
  const p = (async () => {
    const title = await generateReportTitle({ description: report.description, pageReported: report.pageReported });
    if (title) await ProblemReport.updateOne({ _id: report._id }, { $set: { title } });
  })().catch(err => console.error('[reportTitle] failed to store:', err.message));
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
}

async function _flushPendingTitles() {
  while (pending.size) await Promise.allSettled([...pending]);
}

module.exports = { generateReportTitle, scheduleReportTitle, cleanTitle, _flushPendingTitles, MAX_TITLE };
