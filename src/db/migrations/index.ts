/**
 * Migration registry
 * Exports all migrations sorted by version
 */

import type { Migration } from "./types.ts";

import { migration as m001 } from "./001_initial_schema.ts";
import { migration as m002 } from "./002_add_test_run_id.ts";
import { migration as m003 } from "./003_add_cache_isolation_note.ts";
import { migration as m004 } from "./004_add_diem_balance.ts";

/**
 * All migrations sorted by version
 */
export const ALL_MIGRATIONS: Migration[] = [m001, m002, m003, m004];

/**
 * Get a specific migration by version number
 */
export function getMigrationByVersion(version: number): Migration | undefined {
  return ALL_MIGRATIONS.find((m) => m.version === version);
}
