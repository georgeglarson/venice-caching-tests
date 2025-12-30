/**
 * Migration 003: Add cache_isolation_note column
 * Adds cache_isolation_note column to test_results for cache isolation documentation
 */

import type { Database } from "bun:sqlite";
import type { Migration } from "./types.ts";

export const migration: Migration = {
  version: 3,
  name: "add_cache_isolation_note",
  up: (db: Database) => {
    db.exec("ALTER TABLE test_results ADD COLUMN cache_isolation_note TEXT");
  },
};
