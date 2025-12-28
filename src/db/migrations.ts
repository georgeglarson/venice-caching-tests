/**
 * Database migrations and initialization
 */

import { Database } from "bun:sqlite";
import { SCHEMA } from "./schema.ts";

const DB_PATH = "./data/cache-health.db";

let db: Database | null = null;

export function getDatabase(): Database {
  if (!db) {
    // Ensure data directory exists
    const dataDir = "./data";
    const fs = require("fs");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
  return db;
}

export function initDatabase(): void {
  const database = getDatabase();
  database.exec(SCHEMA);

  // Run migrations for new columns on existing tables
  migrateAddColumns(database);

  console.log("Database initialized at:", DB_PATH);
}

function migrateAddColumns(database: Database): void {
  // Check if test_run_id column exists, if not add it
  const columns = database.prepare("PRAGMA table_info(test_results)").all() as Array<{ name: string }>;
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes("test_run_id")) {
    database.exec("ALTER TABLE test_results ADD COLUMN test_run_id TEXT");
    console.log("Migration: Added test_run_id column");
  }

  if (!columnNames.includes("cache_isolation_note")) {
    database.exec("ALTER TABLE test_results ADD COLUMN cache_isolation_note TEXT");
    console.log("Migration: Added cache_isolation_note column");
  }

  // Check token_usage table for diem_balance column
  const usageColumns = database.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
  const usageColumnNames = usageColumns.map(c => c.name);

  if (usageColumnNames.length > 0 && !usageColumnNames.includes("diem_balance")) {
    database.exec("ALTER TABLE token_usage ADD COLUMN diem_balance REAL");
    console.log("Migration: Added diem_balance column to token_usage");
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Run migrations if called directly
if (import.meta.main) {
  initDatabase();
  console.log("Migrations complete!");
  closeDatabase();
}
