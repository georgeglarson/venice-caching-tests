/**
 * Database migrations and initialization
 */

import { Database } from "bun:sqlite";
import { ensureMigrationTable, getAppliedMigrations, recordMigration } from "./migrations/tracker.ts";
import { ALL_MIGRATIONS } from "./migrations/index.ts";

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

/**
 * Detects if the database is a legacy database (has tables but no migration tracking)
 */
export function detectLegacyDatabase(database: Database): boolean {
  // Check if test_results table exists
  const testResultsTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_results'")
    .get();

  // Check if schema_migrations table exists
  const migrationsTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();

  // Legacy database: has test_results but no schema_migrations
  return testResultsTable !== null && migrationsTable === null;
}

/**
 * Gets column names for a table
 */
function getColumnNames(database: Database, tableName: string): string[] {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.map((c) => c.name);
}

/**
 * Checks if a table exists in the database
 */
function tableExists(database: Database, tableName: string): boolean {
  const result = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return result !== null;
}

/**
 * Handles legacy database by ensuring base tables exist and marking appropriate migrations as applied
 */
export function handleLegacyDatabase(database: Database): void {
  console.log("Detected legacy database, marking existing migrations as applied...");

  // Ensure migration table exists first
  ensureMigrationTable(database);

  // Check if base tables exist - legacy DB has test_results but may be missing token_usage
  const hasTestResults = tableExists(database, "test_results");
  const hasTokenUsage = tableExists(database, "token_usage");

  // If any base table is missing, run migration 001 to create them
  // The migration uses CREATE TABLE IF NOT EXISTS so it's safe to run even if some tables exist
  if (!hasTestResults || !hasTokenUsage) {
    console.log("Legacy database missing base tables, creating them...");
    const initialMigration = ALL_MIGRATIONS.find((m) => m.version === 1);
    if (initialMigration) {
      initialMigration.up(database);
    }
  }

  // Now mark migration 001 as applied (tables are confirmed to exist)
  recordMigration(database, 1, "initial_schema");

  // Check test_results columns
  const testResultsColumns = getColumnNames(database, "test_results");

  // Migration 002 (add_test_run_id)
  if (testResultsColumns.includes("test_run_id")) {
    recordMigration(database, 2, "add_test_run_id");
  }

  // Migration 003 (add_cache_isolation_note)
  if (testResultsColumns.includes("cache_isolation_note")) {
    recordMigration(database, 3, "add_cache_isolation_note");
  }

  // Check token_usage columns
  const tokenUsageColumns = getColumnNames(database, "token_usage");

  // Migration 004 (add_diem_balance)
  if (tokenUsageColumns.includes("diem_balance")) {
    recordMigration(database, 4, "add_diem_balance");
  }

  console.log("Legacy database migration tracking initialized");
}

/**
 * Runs all pending migrations
 */
export function runPendingMigrations(database: Database): number {
  const appliedMigrations = getAppliedMigrations(database);
  const appliedVersions = new Set(appliedMigrations.map((m) => m.version));

  const pendingMigrations = ALL_MIGRATIONS.filter((m) => !appliedVersions.has(m.version)).sort(
    (a, b) => a.version - b.version
  );

  let appliedCount = 0;

  for (const migration of pendingMigrations) {
    console.log(`Running migration ${migration.version}: ${migration.name}`);
    migration.up(database);
    recordMigration(database, migration.version, migration.name);
    console.log(`Migration ${migration.version} completed`);
    appliedCount++;
  }

  return appliedCount;
}

export function initDatabase(): void {
  const database = getDatabase();

  // Handle legacy databases without migration tracking
  if (detectLegacyDatabase(database)) {
    handleLegacyDatabase(database);
  } else {
    // Ensure migration table exists for new databases
    ensureMigrationTable(database);
  }

  // Run any pending migrations
  const applied = runPendingMigrations(database);

  if (applied > 0) {
    console.log(`Applied ${applied} migration(s)`);
  }

  console.log("Database initialized at:", DB_PATH);
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
