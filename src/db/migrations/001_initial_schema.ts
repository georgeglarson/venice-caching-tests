/**
 * Migration 001: Initial schema
 * Creates the base tables for test results and token usage tracking
 */

import type { Database } from "bun:sqlite";
import type { Migration } from "./types.ts";

export const migration: Migration = {
  version: 1,
  name: "initial_schema",
  up: (db: Database) => {
    db.exec(`
      -- Test results table
      CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tested_at TEXT NOT NULL DEFAULT (datetime('now')),
        model_id TEXT NOT NULL,
        model_name TEXT,
        test_name TEXT NOT NULL,
        caching_works INTEGER NOT NULL DEFAULT 0,
        cache_hit_rate REAL,
        details_json TEXT,
        error TEXT
      );

      -- Token usage tracking for cost analysis
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        model_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_results_time ON test_results(tested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_results_model ON test_results(model_id);
      CREATE INDEX IF NOT EXISTS idx_usage_time ON token_usage(recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model_id);
    `);
  },
};
