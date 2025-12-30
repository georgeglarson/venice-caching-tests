/**
 * Migration 004: Add diem_balance column
 * Adds diem_balance column to token_usage for tracking account balance
 */

import type { Database } from "bun:sqlite";
import type { Migration } from "./types.ts";

export const migration: Migration = {
  version: 4,
  name: "add_diem_balance",
  up: (db: Database) => {
    db.exec("ALTER TABLE token_usage ADD COLUMN diem_balance REAL");
  },
};
