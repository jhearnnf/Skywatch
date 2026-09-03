// Global Resend mock — wired via jest.config.js `setupFilesAfterEach`.
// Prevents real API calls (and daily quota burn) across the whole test suite.
// Tests that need to assert email side-effects can import the send mock via
//   const { __sendMock } = require('resend');
//
// `batch.send` is mocked too, because the CBAT questionnaire mailer sends
// through it (see utils/surveyEmail.js). It echoes one id per message so the
// caller's per-recipient success mapping has something to read; a test that
// wants a partial or total failure overrides __batchMock directly.
jest.mock('resend', () => {
  const sendMock = jest.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null });
  const batchMock = jest.fn().mockImplementation(async (messages = []) => ({
    data: { data: messages.map((_, i) => ({ id: `mock-batch-${i}` })) },
    error: null,
  }));
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send: sendMock },
      batch:  { send: batchMock },
    })),
    __sendMock: sendMock,
    __batchMock: batchMock,
  };
});
