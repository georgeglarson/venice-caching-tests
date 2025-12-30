/**
 * Migration system tests
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ensureMigrationTable,
  getAppliedMigrations,
  recordMigration,
  isMigrationApplied,
} from "../../../src/db/migrations/tracker.ts";
import { ALL_MIGRATIONS, getMigrationByVersion } from "../../../src/db/migrations/index.ts";
import {
  runPendingMigrations,
  detectLegacyDatabase,
  handleLegacyDatabase,
} from "../../../src/db/migrations.ts";
import type { Migration } from "../../../src/db/migrations/types.ts";

describe("Migration Tracker", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("ensureMigrationTable creates the tracking table", () => {
    ensureMigrationTable(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .all();

    expect(tables).toHaveLength(1);
  });

  test("ensureMigrationTable is idempotent", () => {
    ensureMigrationTable(db);
    ensureMigrationTable(db);
    ensureMigrationTable(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .all();

    expect(tables).toHaveLength(1);
  });

  test("getAppliedMigrations returns empty array for new database", () => {
    ensureMigrationTable(db);

    const applied = getAppliedMigrations(db);

    expect(applied).toEqual([]);
  });

  test("recordMigration inserts records correctly", () => {
    ensureMigrationTable(db);

    recordMigration(db, 1, "initial_schema");

    const records = db.prepare("SELECT version, name FROM schema_migrations").all();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ version: 1, name: "initial_schema" });
  });

  test("recordMigration sets applied_at timestamp", () => {
    ensureMigrationTable(db);

    recordMigration(db, 1, "initial_schema");

    const record = db.prepare("SELECT applied_at FROM schema_migrations WHERE version = 1").get() as {
      applied_at: string;
    };

    expect(record.applied_at).toBeTruthy();
    // Should be a valid datetime
    expect(new Date(record.applied_at).getTime()).not.toBeNaN();
  });

  test("isMigrationApplied returns false for unapplied migration", () => {
    ensureMigrationTable(db);

    const result = isMigrationApplied(db, 1);

    expect(result).toBe(false);
  });

  test("isMigrationApplied returns true for applied migration", () => {
    ensureMigrationTable(db);
    recordMigration(db, 1, "initial_schema");

    const result = isMigrationApplied(db, 1);

    expect(result).toBe(true);
  });

  test("getAppliedMigrations returns all applied migrations in order", () => {
    ensureMigrationTable(db);
    recordMigration(db, 1, "initial_schema");
    recordMigration(db, 2, "add_test_run_id");
    recordMigration(db, 3, "add_cache_isolation_note");

    const applied = getAppliedMigrations(db);

    expect(applied).toHaveLength(3);
    expect(applied[0].version).toBe(1);
    expect(applied[1].version).toBe(2);
    expect(applied[2].version).toBe(3);
  });
});

describe("Migration Registry", () => {
  test("ALL_MIGRATIONS contains all migrations", () => {
    expect(ALL_MIGRATIONS.length).toBeGreaterThanOrEqual(4);
  });

  test("ALL_MIGRATIONS are sorted by version", () => {
    for (let i = 1; i < ALL_MIGRATIONS.length; i++) {
      expect(ALL_MIGRATIONS[i].version).toBeGreaterThan(ALL_MIGRATIONS[i - 1].version);
    }
  });

  test("getMigrationByVersion returns correct migration", () => {
    const migration = getMigrationByVersion(1);

    expect(migration).toBeDefined();
    expect(migration?.version).toBe(1);
    expect(migration?.name).toBe("initial_schema");
  });

  test("getMigrationByVersion returns undefined for non-existent version", () => {
    const migration = getMigrationByVersion(999);

    expect(migration).toBeUndefined();
  });

  test("all migrations have required properties", () => {
    for (const migration of ALL_MIGRATIONS) {
      expect(migration.version).toBeGreaterThan(0);
      expect(migration.name).toBeTruthy();
      expect(typeof migration.up).toBe("function");
    }
  });
});

describe("Migration Execution", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("migration 001 creates base tables", () => {
    const migration = getMigrationByVersion(1)!;
    migration.up(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("test_results");
    expect(tableNames).toContain("token_usage");
  });

  test("migration 002 adds test_run_id column", () => {
    // First run migration 001
    getMigrationByVersion(1)!.up(db);

    // Then run migration 002
    getMigrationByVersion(2)!.up(db);

    const columns = db.prepare("PRAGMA table_info(test_results)").all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("test_run_id");
  });

  test("migration 003 adds cache_isolation_note column", () => {
    // Run prerequisite migrations
    getMigrationByVersion(1)!.up(db);
    getMigrationByVersion(2)!.up(db);

    // Run migration 003
    getMigrationByVersion(3)!.up(db);

    const columns = db.prepare("PRAGMA table_info(test_results)").all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("cache_isolation_note");
  });

  test("migration 004 adds diem_balance column", () => {
    // Run prerequisite migrations
    getMigrationByVersion(1)!.up(db);

    // Run migration 004
    getMigrationByVersion(4)!.up(db);

    const columns = db.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("diem_balance");
  });

  test("running all migrations produces complete schema", () => {
    for (const migration of ALL_MIGRATIONS) {
      migration.up(db);
    }

    // Check test_results columns
    const testResultsColumns = db.prepare("PRAGMA table_info(test_results)").all() as Array<{ name: string }>;
    const testResultsColumnNames = testResultsColumns.map((c) => c.name);

    expect(testResultsColumnNames).toContain("id");
    expect(testResultsColumnNames).toContain("tested_at");
    expect(testResultsColumnNames).toContain("model_id");
    expect(testResultsColumnNames).toContain("test_name");
    expect(testResultsColumnNames).toContain("caching_works");
    expect(testResultsColumnNames).toContain("cache_hit_rate");
    expect(testResultsColumnNames).toContain("test_run_id");
    expect(testResultsColumnNames).toContain("cache_isolation_note");

    // Check token_usage columns
    const tokenUsageColumns = db.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
    const tokenUsageColumnNames = tokenUsageColumns.map((c) => c.name);

    expect(tokenUsageColumnNames).toContain("id");
    expect(tokenUsageColumnNames).toContain("recorded_at");
    expect(tokenUsageColumnNames).toContain("model_id");
    expect(tokenUsageColumnNames).toContain("prompt_tokens");
    expect(tokenUsageColumnNames).toContain("cached_tokens");
    expect(tokenUsageColumnNames).toContain("completion_tokens");
    expect(tokenUsageColumnNames).toContain("diem_balance");
  });

  test("migrations are tracked after execution", () => {
    ensureMigrationTable(db);

    for (const migration of ALL_MIGRATIONS) {
      migration.up(db);
      recordMigration(db, migration.version, migration.name);
    }

    const applied = getAppliedMigrations(db);

    expect(applied).toHaveLength(ALL_MIGRATIONS.length);
  });

  test("already applied migrations are not re-run", () => {
    ensureMigrationTable(db);

    // Run and record migration 001
    const m1 = getMigrationByVersion(1)!;
    m1.up(db);
    recordMigration(db, m1.version, m1.name);

    // Simulate checking for pending migrations
    const applied = getAppliedMigrations(db);
    const appliedVersions = new Set(applied.map((m) => m.version));

    const pending = ALL_MIGRATIONS.filter((m) => !appliedVersions.has(m.version));

    // Migration 001 should not be in pending list
    expect(pending.find((m) => m.version === 1)).toBeUndefined();
    expect(pending.length).toBe(ALL_MIGRATIONS.length - 1);
  });
});

describe("Migration Order", () => {
  test("migrations are numbered sequentially", () => {
    const versions = ALL_MIGRATIONS.map((m) => m.version);

    for (let i = 0; i < versions.length; i++) {
      expect(versions[i]).toBe(i + 1);
    }
  });

  test("migration versions are unique", () => {
    const versions = ALL_MIGRATIONS.map((m) => m.version);
    const uniqueVersions = new Set(versions);

    expect(uniqueVersions.size).toBe(versions.length);
  });

  test("migration names are unique", () => {
    const names = ALL_MIGRATIONS.map((m) => m.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });
});

describe("runPendingMigrations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureMigrationTable(db);
  });

  afterEach(() => {
    db.close();
  });

  test("applies all migrations on fresh database", () => {
    const appliedCount = runPendingMigrations(db);

    expect(appliedCount).toBe(ALL_MIGRATIONS.length);

    // Verify all migrations are recorded
    const applied = getAppliedMigrations(db);
    expect(applied).toHaveLength(ALL_MIGRATIONS.length);
  });

  test("applies only pending migrations", () => {
    // Pre-apply first two migrations
    getMigrationByVersion(1)!.up(db);
    recordMigration(db, 1, "initial_schema");
    getMigrationByVersion(2)!.up(db);
    recordMigration(db, 2, "add_test_run_id");

    const appliedCount = runPendingMigrations(db);

    // Should only apply migrations 3 and 4
    expect(appliedCount).toBe(ALL_MIGRATIONS.length - 2);

    const applied = getAppliedMigrations(db);
    expect(applied).toHaveLength(ALL_MIGRATIONS.length);
  });

  test("is idempotent - running twice applies nothing the second time", () => {
    const firstRun = runPendingMigrations(db);
    const secondRun = runPendingMigrations(db);

    expect(firstRun).toBe(ALL_MIGRATIONS.length);
    expect(secondRun).toBe(0);

    const applied = getAppliedMigrations(db);
    expect(applied).toHaveLength(ALL_MIGRATIONS.length);
  });

  test("returns 0 when all migrations are already applied", () => {
    // Apply all migrations first
    for (const migration of ALL_MIGRATIONS) {
      migration.up(db);
      recordMigration(db, migration.version, migration.name);
    }

    const appliedCount = runPendingMigrations(db);

    expect(appliedCount).toBe(0);
  });

  test("applies migrations in version order", () => {
    runPendingMigrations(db);

    const applied = getAppliedMigrations(db);
    for (let i = 1; i < applied.length; i++) {
      expect(applied[i].version).toBeGreaterThan(applied[i - 1].version);
    }
  });
});

describe("Legacy Database Handling", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("detectLegacyDatabase", () => {
    test("returns false for fresh database", () => {
      const result = detectLegacyDatabase(db);
      expect(result).toBe(false);
    });

    test("returns false for database with schema_migrations table", () => {
      ensureMigrationTable(db);
      const result = detectLegacyDatabase(db);
      expect(result).toBe(false);
    });

    test("returns true for database with test_results but no schema_migrations", () => {
      // Create test_results table without migration tracking
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          tested_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0
        )
      `);

      const result = detectLegacyDatabase(db);
      expect(result).toBe(true);
    });

    test("returns false for database with both test_results and schema_migrations", () => {
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          model_id TEXT NOT NULL
        )
      `);
      ensureMigrationTable(db);

      const result = detectLegacyDatabase(db);
      expect(result).toBe(false);
    });
  });

  describe("handleLegacyDatabase", () => {
    test("creates missing token_usage table when test_results exists", () => {
      // Simulate legacy DB with test_results but no token_usage
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          tested_at TEXT NOT NULL DEFAULT (datetime('now')),
          model_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0
        )
      `);

      handleLegacyDatabase(db);

      // Verify token_usage was created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'")
        .all();
      expect(tables).toHaveLength(1);

      // Verify migration 1 is recorded
      const applied = getAppliedMigrations(db);
      expect(applied.find((m) => m.version === 1)).toBeDefined();
    });

    test("marks migration 1 as applied after ensuring base tables exist", () => {
      // Simulate legacy DB with test_results matching the original schema but missing token_usage
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tested_at TEXT NOT NULL DEFAULT (datetime('now')),
          model_id TEXT NOT NULL,
          model_name TEXT,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0,
          cache_hit_rate REAL,
          details_json TEXT,
          error TEXT
        )
      `);

      handleLegacyDatabase(db);

      // Migration 1 should be recorded
      expect(isMigrationApplied(db, 1)).toBe(true);

      // token_usage should exist now
      const columns = db.prepare("PRAGMA table_info(token_usage)").all() as Array<{ name: string }>;
      expect(columns.length).toBeGreaterThan(0);
    });

    test("records migrations for columns that already exist", () => {
      // Simulate legacy DB with all columns already present
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          tested_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0,
          test_run_id TEXT,
          cache_isolation_note TEXT
        );

        CREATE TABLE token_usage (
          id INTEGER PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          diem_balance REAL
        );
      `);

      handleLegacyDatabase(db);

      // All migrations should be marked as applied
      expect(isMigrationApplied(db, 1)).toBe(true);
      expect(isMigrationApplied(db, 2)).toBe(true);
      expect(isMigrationApplied(db, 3)).toBe(true);
      expect(isMigrationApplied(db, 4)).toBe(true);
    });

    test("only records migrations for columns that exist", () => {
      // Simulate legacy DB with partial columns (only test_run_id added)
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          tested_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0,
          test_run_id TEXT
        );

        CREATE TABLE token_usage (
          id INTEGER PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0
        );
      `);

      handleLegacyDatabase(db);

      // Migration 1 and 2 should be applied
      expect(isMigrationApplied(db, 1)).toBe(true);
      expect(isMigrationApplied(db, 2)).toBe(true);
      // Migrations 3 and 4 should NOT be applied (columns don't exist)
      expect(isMigrationApplied(db, 3)).toBe(false);
      expect(isMigrationApplied(db, 4)).toBe(false);
    });

    test("allows runPendingMigrations to add missing columns after legacy handling", () => {
      // Simulate legacy DB with only base schema
      db.exec(`
        CREATE TABLE test_results (
          id INTEGER PRIMARY KEY,
          tested_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          test_name TEXT NOT NULL,
          caching_works INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE token_usage (
          id INTEGER PRIMARY KEY,
          recorded_at TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0
        );
      `);

      // Handle legacy database first
      handleLegacyDatabase(db);

      // Only migration 1 should be recorded at this point
      expect(isMigrationApplied(db, 1)).toBe(true);
      expect(isMigrationApplied(db, 2)).toBe(false);

      // Run pending migrations
      const applied = runPendingMigrations(db);

      // Should apply migrations 2, 3, and 4
      expect(applied).toBe(3);

      // Verify all columns were added
      const testResultsColumns = db
        .prepare("PRAGMA table_info(test_results)")
        .all() as Array<{ name: string }>;
      const testResultsColumnNames = testResultsColumns.map((c) => c.name);
      expect(testResultsColumnNames).toContain("test_run_id");
      expect(testResultsColumnNames).toContain("cache_isolation_note");

      const tokenUsageColumns = db
        .prepare("PRAGMA table_info(token_usage)")
        .all() as Array<{ name: string }>;
      const tokenUsageColumnNames = tokenUsageColumns.map((c) => c.name);
      expect(tokenUsageColumnNames).toContain("diem_balance");
    });

    test("is safe to run even if tables already fully exist", () => {
      // Run full migration first
      getMigrationByVersion(1)!.up(db);

      // Now handle as legacy (simulating a race condition or retry)
      handleLegacyDatabase(db);

      // Should not throw and migration 1 should be recorded
      expect(isMigrationApplied(db, 1)).toBe(true);

      // Tables should still work
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("test_results");
      expect(tableNames).toContain("token_usage");
    });
  });
});
