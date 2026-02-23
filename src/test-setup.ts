// Global test setup for frameforge-api-gateway
// This file runs before each test suite

// Set default timeout for all tests
jest.setTimeout(30000);

// Suppress console output during tests (optional - comment out for debugging)
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});
