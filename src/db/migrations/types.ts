/**
 * Migration type definitions
 */

import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}
