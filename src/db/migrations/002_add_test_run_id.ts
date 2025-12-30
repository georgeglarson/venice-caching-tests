/**
 * Migration 002: Add test_run_id column
 * Adds test_run_id column to test_results for grouping test runs
 */

import type { Database } from "bun:sqlite";
import type { Migration } from "./types.ts";

export const migration: Migration = {
  version: 2,
  name: "add_test_run_id",
  up: (db: Database) => {
    db.exec("ALTER TABLE test_results ADD COLUMN test_run_id TEXT");
  },
};
