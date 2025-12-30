/**
 * Migration tracking functions
 */

import type { Database } from "bun:sqlite";
import type { MigrationRecord } from "./types.ts";

/**
 * Ensures the schema_migrations table exists for tracking applied migrations
 */
export function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Returns all applied migration versions
 */
export function getAppliedMigrations(db: Database): MigrationRecord[] {
  return db
    .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC")
    .all() as MigrationRecord[];
}

/**
 * Records a migration as applied
 */
export function recordMigration(db: Database, version: number, name: string): void {
  db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(version, name);
}

/**
 * Checks if a specific migration version has been applied
 */
export function isMigrationApplied(db: Database, version: number): boolean {
  const result = db
    .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
    .get(version);
  return result !== null;
}
