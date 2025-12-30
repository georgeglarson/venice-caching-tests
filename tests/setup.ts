/**
 * Global test setup and configuration
 */

import { beforeAll, beforeEach, afterAll, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { setDelayFunction } from "../src/utils/retry.ts";

// Set test environment variables before any other imports
process.env.VENICE_API_KEY = "test-api-key-for-testing";
process.env.NODE_ENV = "test";
process.env.DEBUG_API_REQUESTS = "false";

// Skip delays in tests for faster execution
setDelayFunction(async () => {});

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

/**
 * Creates an in-memory SQLite database with the test schema
 */
export function createTestDatabase(): Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tested_at TEXT NOT NULL DEFAULT (datetime('now')),
      model_id TEXT NOT NULL,
      model_name TEXT,
      test_name TEXT NOT NULL,
      caching_works INTEGER NOT NULL DEFAULT 0,
      cache_hit_rate REAL,
      details_json TEXT,
      error TEXT,
      test_run_id TEXT,
      cache_isolation_note TEXT
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      model_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      diem_balance REAL
    );

    CREATE INDEX IF NOT EXISTS idx_results_time ON test_results(tested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_results_model ON test_results(model_id);
    CREATE INDEX IF NOT EXISTS idx_usage_time ON token_usage(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model_id);
  `);

  return db;
}

/**
 * Clears all data from the test database
 */
export function clearTestDatabase(db: Database): void {
  db.exec("DELETE FROM test_results");
  db.exec("DELETE FROM token_usage");
}

/**
 * Inserts sample test data into the database
 */
export function seedTestDatabase(db: Database): void {
  // Insert sample test results
  const insertResult = db.prepare(`
    INSERT INTO test_results (tested_at, model_id, model_name, test_name, caching_works, cache_hit_rate, details_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertResult.run("2024-01-15T10:00:00Z", "llama-3.3-70b", "Llama 3.3 70B", "basic", 1, 80, "{}", null);
  insertResult.run("2024-01-15T10:05:00Z", "llama-3.3-70b", "Llama 3.3 70B", "persistence", 1, 75, "{}", null);
  insertResult.run("2024-01-15T10:10:00Z", "deepseek-r1", "DeepSeek R1", "basic", 0, 0, "{}", null);
  insertResult.run("2024-01-14T10:00:00Z", "llama-3.3-70b", "Llama 3.3 70B", "basic", 1, 70, "{}", null);

  // Insert sample token usage
  const insertUsage = db.prepare(`
    INSERT INTO token_usage (recorded_at, model_id, prompt_tokens, cached_tokens, completion_tokens, diem_balance)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUsage.run("2024-01-15T10:00:00Z", "llama-3.3-70b", 1000, 800, 50, 99.5);
  insertUsage.run("2024-01-15T10:05:00Z", "llama-3.3-70b", 1200, 900, 60, 99.3);
  insertUsage.run("2024-01-15T10:10:00Z", "deepseek-r1", 500, 0, 30, 99.1);
}

/**
 * Mock the global fetch function
 */
export function mockGlobalFetch(mockFn: typeof fetch): void {
  globalThis.fetch = mockFn;
}

/**
 * Restore the original fetch function
 */
export function restoreGlobalFetch(): void {
  globalThis.fetch = originalFetch;
}

/**
 * Utility to wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a deferred promise for testing async behavior
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Captures console output for testing
 */
export function captureConsole(): {
  logs: string[];
  errors: string[];
  warns: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };

  return {
    logs,
    errors,
    warns,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

/**
 * Restores the retry delay function to the no-op test version.
 * Call this in afterEach if a test modifies the delay function.
 */
export function restoreTestDelayFunction(): void {
  setDelayFunction(async () => {});
}

// Export test utilities
export { mock } from "bun:test";
export { setDelayFunction } from "../src/utils/retry.ts";
