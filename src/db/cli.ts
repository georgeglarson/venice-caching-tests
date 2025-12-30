/**
 * Database migration CLI
 */

import { getDatabase, initDatabase, closeDatabase } from "./migrations.ts";
import { ensureMigrationTable, getAppliedMigrations } from "./migrations/tracker.ts";
import { ALL_MIGRATIONS } from "./migrations/index.ts";

/**
 * Shows the current migration status
 */
function showMigrationStatus(): void {
  const database = getDatabase();
  ensureMigrationTable(database);

  const appliedMigrations = getAppliedMigrations(database);
  const appliedVersions = new Map(appliedMigrations.map((m) => [m.version, m]));

  console.log("\nMigration Status");
  console.log("================\n");

  console.log("Version | Name                      | Status   | Applied At");
  console.log("--------|---------------------------|----------|---------------------");

  for (const migration of ALL_MIGRATIONS) {
    const applied = appliedVersions.get(migration.version);
    const status = applied ? "Applied" : "Pending";
    const appliedAt = applied?.applied_at || "-";
    const name = migration.name.padEnd(25);
    const statusPadded = status.padEnd(8);

    console.log(`${String(migration.version).padStart(7)} | ${name} | ${statusPadded} | ${appliedAt}`);
  }

  console.log("");
  console.log(`${appliedMigrations.length} of ${ALL_MIGRATIONS.length} migrations applied`);

  closeDatabase();
}

/**
 * Runs pending migrations
 */
function runMigrations(): void {
  initDatabase();
  closeDatabase();
}

/**
 * Shows usage help
 */
function showHelp(): void {
  console.log(`
Database Migration CLI

Usage: bun run src/db/cli.ts <command>

Commands:
  status    Show migration status
  run       Run pending migrations

Examples:
  bun run src/db/cli.ts status
  bun run src/db/cli.ts run
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "status":
      showMigrationStatus();
      break;
    case "run":
      runMigrations();
      break;
    case undefined:
      showMigrationStatus();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
