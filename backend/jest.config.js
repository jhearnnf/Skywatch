module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 30000,
  forceExit: true,
  setupFilesAfterEnv: ['<rootDir>/__tests__/helpers/mockResend.js'],
};
