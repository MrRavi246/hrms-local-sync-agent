/**
 * CMK HRMS: Database Inspector & Sync State Updater
 * =====================================================
 * Connects to the local SQL Server Express database, inspects ALL tables
 * (schema, columns, row counts, indexes, PK strategy), and writes a full
 * database-schema snapshot file alongside the sync-state JSON so the sync
 * engine always has an up-to-date picture of what is available.
 *
 * Usage:
 *   npm run db-inspect               # full scan, update state
 *   npm run db-inspect -- --table=X  # inspect a single table
 *   npm run db-inspect -- --dry-run  # scan without writing files
 *   npm run db-inspect -- --reset-cursor  # reset sync cursor to origin
 */
export {};
