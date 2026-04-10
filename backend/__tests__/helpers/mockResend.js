// Global Resend mock — wired via jest.config.js `setupFilesAfterEach`.
// Prevents real API calls (and daily quota burn) across the whole test suite.
// Tests that need to assert email side-effects can import the send mock via
//   const { __sendMock } = require('resend');
jest.mock('resend', () => {
  const sendMock = jest.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null });
  return {
    Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
    __sendMock: sendMock,
  };
});
