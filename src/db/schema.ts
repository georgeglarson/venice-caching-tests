/**
 * Simplified SQLite schema - just test results, no run tracking
 */

export const SCHEMA = `
-- Test results only - no runs, no stats tables
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

-- Token usage tracking for cost analysis
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_id TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  diem_balance REAL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_results_time ON test_results(tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_model ON test_results(model_id);
CREATE INDEX IF NOT EXISTS idx_usage_time ON token_usage(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model_id);
`;

export interface TestResultRow {
  id: number;
  tested_at: string;
  model_id: string;
  model_name: string | null;
  test_name: string;
  caching_works: number;
  cache_hit_rate: number | null;
  details_json: string | null;
  error: string | null;
  test_run_id: string | null;
  cache_isolation_note: string | null;
}

export interface TokenUsageRow {
  id: number;
  recorded_at: string;
  model_id: string;
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
}
