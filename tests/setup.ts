/**
 * Vitest global setup
 *
 * Runs before each test file. Sets NODE_ENV and provides
 * shared utilities for integration tests.
 */

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.FOUNDER_EMAILS = "founder@test.com";
// Dummy DATABASE_URL so db.ts module doesn't throw on import.
// Actual DB calls should be mocked in individual tests.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/acreos_test";
