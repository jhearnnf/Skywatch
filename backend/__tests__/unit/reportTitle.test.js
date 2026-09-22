/**
 * utils/reportTitle — the one-line summary written for a problem report.
 *
 * The rail row and the admin card used to quote the first eighty characters
 * of the report, which for "test problem bro just seeing how it work." is the
 * whole report and for a real one is the least informative part. The model
 * writes a title instead; these pin down what it is fed, how its answer is
 * cleaned, and that nothing here can ever fail the report.
 */
jest.mock('../../utils/openRouter', () => ({
  ...jest.requireActual('../../utils/openRouter'),
  callOpenRouter: jest.fn(),
}));
jest.mock('../../models/ProblemReport', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/ChatConversation', () => ({ updateOne: jest.fn().mockResolvedValue({}) }));

const { callOpenRouter } = require('../../utils/openRouter');
const ProblemReport = require('../../models/ProblemReport');
const ChatConversation = require('../../models/ChatConversation');
const { generateReportTitle, scheduleReportTitle, scheduleTicketTitle, cleanTitle, excerptTitle, _flushPendingTitles } = require('../../utils/reportTitle');

const answer = (text) => callOpenRouter.mockResolvedValue({ choices: [{ message: { content: text } }] });

beforeEach(() => {
  process.env.OPENROUTER_KEY = 'test-key';
  callOpenRouter.mockReset();
  ProblemReport.updateOne.mockClear();
  ChatConversation.updateOne.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe('generateReportTitle', () => {
  it('asks the small model for a title, giving it the report and the page', async () => {
    answer('Instruments needles drawn off the dial');
    const title = await generateReportTitle({
      description: 'the needles are either completely off the screen or the bottom of the needle is not in the centre',
      pageReported: 'CBAT · Instruments',
    });
    expect(title).toBe('Instruments needles drawn off the dial');
    const { body, feature } = callOpenRouter.mock.calls[0][0];
    expect(feature).toBe('report-title');
    expect(body.model).toBe('anthropic/claude-haiku-4-5');
    expect(body.messages[1].content).toMatch(/Sent from: CBAT · Instruments/);
    expect(body.messages[1].content).toMatch(/needles are either completely off/);
  });

  it('cleans quotes, a trailing full stop and extra lines off the answer', () => {
    expect(cleanTitle('"Sound never plays on Symbols."\nHere is why…')).toBe('Sound never plays on Symbols');
    expect(cleanTitle('  Leaderboard  shows   wrong rank  ')).toBe('Leaderboard shows wrong rank');
    expect(cleanTitle('')).toBeNull();
  });

  it('caps a runaway answer', () => {
    const t = cleanTitle('word '.repeat(40));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
  });

  it('does nothing without an API key', async () => {
    delete process.env.OPENROUTER_KEY;
    expect(await generateReportTitle({ description: 'anything', pageReported: 'x' })).toBeNull();
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the call fails', async () => {
    callOpenRouter.mockRejectedValue(new Error('OpenRouter 500'));
    expect(await generateReportTitle({ description: 'anything', pageReported: 'x' })).toBeNull();
  });
});

describe('excerptTitle', () => {
  it('is the opening of the message, cut to fit, until the real title lands', () => {
    expect(excerptTitle('  Can I   change my\nagent number? ')).toBe('Can I change my agent number?');
    const t = excerptTitle('x'.repeat(200));
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('scheduleTicketTitle', () => {
  it('stores the title on the thread and on the report it came from', async () => {
    answer('Test report');
    scheduleTicketTitle({ conversationId: 'c1', reportId: 'r1', description: 'test problem bro just seeing how it work.', pageReported: 'unknown' });
    await _flushPendingTitles();
    expect(ChatConversation.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $set: { title: 'Test report' } });
    expect(ProblemReport.updateOne).toHaveBeenCalledWith({ _id: 'r1' }, { $set: { title: 'Test report' } });
  });

  it('titles a thread with no report on its own', async () => {
    answer('Agent number change request');
    scheduleTicketTitle({ conversationId: 'c1', description: 'Can I change my agent number?' });
    await _flushPendingTitles();
    expect(ChatConversation.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $set: { title: 'Agent number change request' } });
    expect(ProblemReport.updateOne).not.toHaveBeenCalled();
  });
});

describe('scheduleReportTitle', () => {
  it('stores the title on the report and its thread once it lands', async () => {
    answer('Test report');
    scheduleReportTitle({ _id: 'r1', conversationId: 'c1', description: 'test problem bro just seeing how it work.', pageReported: 'unknown' });
    await _flushPendingTitles();
    expect(ProblemReport.updateOne).toHaveBeenCalledWith({ _id: 'r1' }, { $set: { title: 'Test report' } });
    expect(ChatConversation.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $set: { title: 'Test report' } });
  });

  it('writes nothing when there is no title to write', async () => {
    answer('');
    scheduleReportTitle({ _id: 'r1', description: 'x', pageReported: 'unknown' });
    await _flushPendingTitles();
    expect(ProblemReport.updateOne).not.toHaveBeenCalled();
  });
});
