"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const index_1 = require("../config/index");
const client_1 = require("../database/client");
const schema_discovery_1 = require("../database/schema-discovery");
const state_manager_1 = require("../state/state-manager");
// ─── CLI arg parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ARG_TABLE = args.find((a) => a.startsWith('--table='))?.split('=')[1] ?? null;
const ARG_DRY_RUN = args.includes('--dry-run');
const ARG_RESET_CURSOR = args.includes('--reset-cursor');
const ARG_JSON = args.includes('--json'); // machine-readable output
const ARG_VERBOSE = args.includes('--verbose'); // show full column lists
const ARG_HELP = args.includes('--help') || args.includes('-h');
// ─── Helpers ──────────────────────────────────────────────────────────────────
function banner(text) {
    const bar = '═'.repeat(70);
    console.log(`\n╔${bar}╗`);
    console.log(`║  ${text.padEnd(68)}║`);
    console.log(`╚${bar}╝\n`);
}
function section(text) {
    console.log(`\n┌${'─'.repeat(68)}┐`);
    console.log(`│  ${text.padEnd(66)}│`);
    console.log(`└${'─'.repeat(68)}┘`);
}
function ok(msg) { console.log(`  ✅  ${msg}`); }
function warn(msg) { console.log(`  ⚠️   ${msg}`); }
function err(msg) { console.log(`  ❌  ${msg}`); }
function info(msg) { console.log(`  ℹ️   ${msg}`); }
function fmtNum(n) {
    return n.toLocaleString('en-IN');
}
// ─── Core: discover ALL tables in a database ──────────────────────────────────
async function discoverAllTables(dbName) {
    const pool = await client_1.dbClient.getPool(dbName);
    const result = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME;
  `);
    return result.recordset.map((r) => ({ schema: r.TABLE_SCHEMA, name: r.TABLE_NAME }));
}
// ─── Core: inspect a single table ────────────────────────────────────────────
async function inspectSingleTable(pool, dbName, schemaName, tableName) {
    try {
        const mssql = await import('mssql');
        // Columns
        const colResult = await pool
            .request()
            .input('tbl', mssql.default.NVarChar, tableName)
            .input('sch', mssql.default.NVarChar, schemaName).query(`
        SELECT
          c.COLUMN_NAME,
          c.DATA_TYPE,
          c.CHARACTER_MAXIMUM_LENGTH,
          c.IS_NULLABLE,
          c.COLUMN_DEFAULT,
          COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = @sch
        ORDER BY c.ORDINAL_POSITION;
      `);
        const columns = colResult.recordset.map((r) => ({
            columnName: r.COLUMN_NAME,
            dataType: r.DATA_TYPE,
            maxLength: r.CHARACTER_MAXIMUM_LENGTH,
            isNullable: r.IS_NULLABLE === 'YES',
            isIdentity: r.IS_IDENTITY === 1,
            columnDefault: r.COLUMN_DEFAULT,
        }));
        // Primary Keys
        const pkResult = await pool
            .request()
            .input('tbl', mssql.default.NVarChar, tableName)
            .input('sch', mssql.default.NVarChar, schemaName).query(`
        SELECT kcu.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
          AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        WHERE tc.TABLE_NAME = @tbl AND tc.TABLE_SCHEMA = @sch
          AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ORDER BY kcu.ORDINAL_POSITION;
      `);
        const primaryKeys = pkResult.recordset.map((r) => r.COLUMN_NAME);
        // Indexes
        const idxResult = await pool
            .request()
            .input('fullTable', mssql.default.NVarChar, `${schemaName}.${tableName}`).query(`
        SELECT
          i.name AS IndexName,
          i.is_unique AS IsUnique,
          i.is_primary_key AS IsPrimaryKey,
          c.name AS ColumnName
        FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID(@fullTable) AND i.name IS NOT NULL
        ORDER BY i.name, ic.key_ordinal;
      `);
        const indexes = idxResult.recordset.map((r) => ({
            indexName: r.IndexName,
            isUnique: Boolean(r.IsUnique),
            isPrimaryKey: Boolean(r.IsPrimaryKey),
            columnName: r.ColumnName,
        }));
        // Row count (with approximate fallback for large tables)
        let totalRecords = 0;
        try {
            const countResult = await pool
                .request()
                .query(`SELECT COUNT(*) AS TotalRecords FROM [${schemaName}].[${tableName}];`);
            totalRecords = countResult.recordset[0]?.TotalRecords ?? 0;
        }
        catch {
            try {
                const approxResult = await pool
                    .request()
                    .input('tbl', mssql.default.NVarChar, tableName).query(`
            SELECT SUM(p.rows) AS TotalRecords
            FROM sys.partitions p
            JOIN sys.tables t ON p.object_id = t.object_id
            WHERE t.name = @tbl AND p.index_id IN (0, 1);
          `);
                totalRecords = approxResult.recordset[0]?.TotalRecords ?? -1;
            }
            catch {
                totalRecords = -1;
            }
        }
        // Cursor strategy
        const identityCol = columns.find((c) => c.isIdentity);
        let cursorStrategy;
        if (identityCol) {
            cursorStrategy = {
                type: 'identity',
                column: identityCol.columnName,
                rationale: `Auto-increment identity column [${identityCol.columnName}] — optimal for incremental sync.`,
            };
        }
        else if (primaryKeys.length === 1) {
            cursorStrategy = {
                type: 'primary_key',
                column: primaryKeys[0],
                rationale: `Single PK [${primaryKeys[0]}] provides monotonic ordering.`,
            };
        }
        else {
            const timeCol = columns.find((c) => c.columnName.toLowerCase() === 'logdatetime') ||
                columns.find((c) => c.columnName.toLowerCase().includes('datetime')) ||
                columns.find((c) => c.columnName.toLowerCase() === 'logdate') ||
                columns.find((c) => c.columnName.toLowerCase().includes('date'));
            if (timeCol) {
                cursorStrategy = {
                    type: 'timestamp',
                    column: timeCol.columnName,
                    rationale: `Timestamp column [${timeCol.columnName}] with hash deduplication.`,
                };
            }
            else {
                cursorStrategy = {
                    type: 'custom',
                    column: columns[0]?.columnName ?? 'unknown',
                    rationale: 'No clear cursor column found — manual configuration recommended.',
                };
            }
        }
        return {
            schemaName,
            tableName,
            fullName: `[${schemaName}].[${tableName}]`,
            columns,
            primaryKeys,
            identityColumn: identityCol?.columnName ?? null,
            indexes,
            totalRecords,
            cursorStrategy,
            isSyncTarget: tableName.toLowerCase() === index_1.config.SOURCE_TABLE.toLowerCase(),
            inspectedAt: new Date().toISOString(),
        };
    }
    catch (e) {
        warn(`Could not inspect [${schemaName}].[${tableName}]: ${e.message}`);
        return null;
    }
}
function loadPreviousSnapshot(snapshotPath) {
    if (!fs_1.default.existsSync(snapshotPath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(snapshotPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function printSummaryTable(tables) {
    const COL = [40, 9, 13, 8, 22];
    const header = [
        'Table'.padEnd(COL[0]),
        'Columns'.padEnd(COL[1]),
        'Records'.padEnd(COL[2]),
        'Has PK'.padEnd(COL[3]),
        'Cursor Strategy'.padEnd(COL[4]),
    ].join('  ');
    const divider = COL.map((w) => '─'.repeat(w)).join('──');
    console.log(`\n  ${header}`);
    console.log(`  ${divider}`);
    for (const t of tables) {
        const marker = t.isSyncTarget ? ' ◀ SYNC' : '';
        const row = [
            `${t.fullName}${marker}`.padEnd(COL[0]),
            String(t.columns.length).padEnd(COL[1]),
            (t.totalRecords >= 0 ? fmtNum(t.totalRecords) : '~approx').padEnd(COL[2]),
            (t.primaryKeys.length > 0 ? `✅ ${t.primaryKeys[0]}` : '❌ none').padEnd(COL[3]),
            `${t.cursorStrategy.type}→[${t.cursorStrategy.column}]`.padEnd(COL[4]),
        ].join('  ');
        console.log(`  ${row}`);
    }
    console.log();
}
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    if (ARG_HELP) {
        console.log(`
CMK HRMS — Database Inspector & Sync State Updater
Usage: npm run db-inspect [options]

Options:
  --table=<name>     Inspect only a specific table (skips full scan)
  --dry-run          Scan and print without writing any files
  --reset-cursor     Reset the sync cursor to origin (forces full re-sync)
  --json             Print machine-readable JSON snapshot to stdout
  --verbose          Show full column details for each table
  --help, -h         Show this help message
`);
        process.exit(0);
    }
    banner('CMK HRMS — DATABASE INSPECTOR & SYNC STATE UPDATER');
    section('Step 1 — Configuration');
    info(`Server:         ${index_1.config.DB_SERVER}${index_1.config.DB_INSTANCE ? '\\' + index_1.config.DB_INSTANCE : ''}`);
    info(`Database:       ${index_1.config.DB_NAME || '(auto-discover)'}`);
    info(`User:           ${index_1.config.DB_USER}`);
    info(`Source table:   ${index_1.config.SOURCE_TABLE}`);
    info(`Dry-run mode:   ${ARG_DRY_RUN ? 'YES — no files will be written' : 'NO'}`);
    if (ARG_TABLE)
        info(`Inspecting only table: ${ARG_TABLE}`);
    section('Step 2 — Connecting to SQL Server');
    let activeDatabaseName;
    try {
        const ping = await client_1.dbClient.ping();
        if (!ping.connected) {
            err(`Connection failed: ${ping.error}`);
            if (ping.error && ping.error.includes('Failed to connect') && ping.error.includes('ms')) {
                console.log('\n  ┌────────────────────────────────────────────────────────────────────────┐');
                console.log('  │ ⚠️  SQLEXPRESS NAMED INSTANCE TIMEOUT DETECTED                         │');
                console.log('  ├────────────────────────────────────────────────────────────────────────┤');
                console.log('  │ 1. "SQL Server Browser" service is STOPPED.                            │');
                console.log('  │    Run in Admin Command Prompt: net start SQLBrowser                   │');
                console.log('  │ 2. "TCP/IP" protocol is DISABLED in SQL Server Configuration Manager.  │');
                console.log('  │    Enable TCP/IP and restart SQL Server (SQLEXPRESS).                  │');
                console.log('  │ 3. One-Click Fix: Right-click scripts\\fix-sql-connection.bat           │');
                console.log('  │    and select "Run as administrator".                                  │');
                console.log('  └────────────────────────────────────────────────────────────────────────┘\n');
            }
            process.exit(1);
        }
        ok(`SQL Server reachable (latency: ${ping.latencyMs}ms)`);
    }
    catch (e) {
        err(`Cannot connect to SQL Server: ${e.message}`);
        console.log('\n  Tip: Check that SQL Server Express is running and TCP/IP is enabled.');
        process.exit(1);
    }
    try {
        if (index_1.config.DB_NAME) {
            activeDatabaseName = index_1.config.DB_NAME;
            ok(`Using configured database: [${activeDatabaseName}]`);
        }
        else {
            info('DB_NAME not set — scanning all databases for biometric table...');
            const found = await schema_discovery_1.SchemaDiscoveryService.findBiometricDatabase();
            if (!found) {
                err('Could not auto-discover biometric database. Set DB_NAME in .env');
                process.exit(1);
            }
            activeDatabaseName = found;
            ok(`Auto-discovered database: [${activeDatabaseName}]`);
        }
    }
    catch (e) {
        err(`Database discovery failed: ${e.message}`);
        process.exit(1);
    }
    const pool = await client_1.dbClient.getPool(activeDatabaseName);
    section('Step 3 — Discovering Tables');
    let tableList = [];
    try {
        const all = await discoverAllTables(activeDatabaseName);
        if (ARG_TABLE) {
            tableList = all.filter((t) => t.name.toLowerCase() === ARG_TABLE.toLowerCase() ||
                `${t.schema}.${t.name}`.toLowerCase() === ARG_TABLE.toLowerCase());
            if (tableList.length === 0) {
                warn(`Table [${ARG_TABLE}] not found. Available tables:`);
                all.forEach((t) => console.log(`    • [${t.schema}].[${t.name}]`));
                process.exit(1);
            }
        }
        else {
            tableList = all;
        }
        ok(`Found ${tableList.length} table(s) in [${activeDatabaseName}]`);
    }
    catch (e) {
        err(`Table discovery failed: ${e.message}`);
        process.exit(1);
    }
    section(`Step 4 — Inspecting ${tableList.length} Table(s)`);
    const inspectedTables = [];
    let totalRecords = 0;
    for (let i = 0; i < tableList.length; i++) {
        const t = tableList[i];
        const progress = `[${String(i + 1).padStart(tableList.length.toString().length, '0')}/${tableList.length}]`;
        process.stdout.write(`  ${progress} [${t.schema}].[${t.name}]... `);
        const summary = await inspectSingleTable(pool, activeDatabaseName, t.schema, t.name);
        if (summary) {
            inspectedTables.push(summary);
            if (summary.totalRecords > 0)
                totalRecords += summary.totalRecords;
            process.stdout.write(`${fmtNum(summary.totalRecords)} rows | ${summary.columns.length} cols | PK: [${summary.primaryKeys.join(', ') || 'none'}]\n`);
            if (ARG_VERBOSE) {
                console.log('     Columns:');
                summary.columns.forEach((c) => {
                    const typeStr = c.maxLength ? `${c.dataType}(${c.maxLength})` : c.dataType;
                    const flags = [c.isIdentity && 'IDENTITY', !c.isNullable && 'NOT NULL'].filter(Boolean).join(', ');
                    console.log(`       • ${c.columnName.padEnd(30)} ${typeStr.padEnd(20)} ${flags}`);
                });
            }
        }
        else {
            process.stdout.write('FAILED (skipped)\n');
        }
    }
    section('Summary');
    printSummaryTable(inspectedTables);
    ok(`Total: ${inspectedTables.length} tables | ${fmtNum(totalRecords)} records in [${activeDatabaseName}]`);
    const syncTarget = inspectedTables.find((t) => t.isSyncTarget);
    if (syncTarget) {
        console.log('\n  ◀ Sync Target Table Details:');
        console.log(`     Full Name:       ${syncTarget.fullName}`);
        console.log(`     Total Records:   ${fmtNum(syncTarget.totalRecords)}`);
        console.log(`     Primary Keys:    ${syncTarget.primaryKeys.join(', ') || 'NONE'}`);
        console.log(`     Identity Col:    ${syncTarget.identityColumn ?? 'NONE'}`);
        console.log(`     Cursor Column:   [${syncTarget.cursorStrategy.column}] (${syncTarget.cursorStrategy.type})`);
        console.log(`     Rationale:       ${syncTarget.cursorStrategy.rationale}`);
    }
    else {
        warn(`Configured SOURCE_TABLE [${index_1.config.SOURCE_TABLE}] was NOT found in the database.`);
        warn('Update SOURCE_TABLE in your .env to match one of the tables above.');
    }
    section('Current Sync State');
    const state = state_manager_1.stateManager.getState();
    console.log(`  Cursor:             ${state.cursor ?? 'NONE (origin)'}`);
    console.log(`  Cursor Column:      ${state.cursorColumn ?? 'not set'}`);
    console.log(`  Cursor Strategy:    ${state.cursorType ?? 'not set'}`);
    console.log(`  Last Sync At:       ${state.lastSyncAt ?? 'never'}`);
    console.log(`  Total Synced:       ${fmtNum(state.totalRecordsSynced)} records`);
    console.log(`  Consecutive Fails:  ${state.consecutiveFailures}`);
    console.log(`  Agent Status:       ${state.agentStatus}`);
    if (ARG_RESET_CURSOR) {
        section('Cursor Reset');
        if (ARG_DRY_RUN) {
            warn('DRY RUN — cursor reset skipped.');
        }
        else {
            warn('Resetting cursor to origin — next sync will re-process ALL records!');
            state_manager_1.stateManager.resetCursor(null);
            ok('Cursor reset to NULL (origin). Next sync starts from the beginning.');
        }
    }
    // Update sync state cursor strategy if sync target found
    if (syncTarget && !ARG_DRY_RUN && !ARG_TABLE) {
        state_manager_1.stateManager.setCursorStrategy(syncTarget.cursorStrategy.column, syncTarget.cursorStrategy.type);
        ok(`Sync state updated — cursor strategy → [${syncTarget.cursorStrategy.column}] (${syncTarget.cursorStrategy.type})`);
    }
    section('Step 5 — Writing Database Snapshot');
    const snapshotPath = path_1.default.join(index_1.config.DATA_DIR, 'db-schema-snapshot.json');
    const prevSnapshot = loadPreviousSnapshot(snapshotPath);
    const currentFullNames = inspectedTables.map((t) => t.fullName);
    let diffInfo;
    if (prevSnapshot) {
        const prevNames = prevSnapshot.tables.map((t) => t.fullName);
        const newTables = currentFullNames.filter((n) => !prevNames.includes(n));
        const removedTables = prevNames.filter((n) => !currentFullNames.includes(n));
        const changedTables = [];
        for (const curr of inspectedTables) {
            const prev = prevSnapshot.tables.find((p) => p.fullName === curr.fullName);
            if (prev && prev.columns.length !== curr.columns.length)
                changedTables.push(curr.fullName);
        }
        diffInfo = {
            generatedAt: prevSnapshot.generatedAt,
            totalTables: prevSnapshot.totalTables,
            newTables,
            removedTables,
            changedTables,
        };
    }
    const snapshot = {
        snapshotVersion: (prevSnapshot?.snapshotVersion ?? 0) + 1,
        generatedAt: new Date().toISOString(),
        server: `${index_1.config.DB_SERVER}${index_1.config.DB_INSTANCE ? '\\' + index_1.config.DB_INSTANCE : ''}`,
        databaseName: activeDatabaseName,
        totalTables: inspectedTables.length,
        totalRecordsAcrossAllTables: totalRecords,
        syncTargetTable: index_1.config.SOURCE_TABLE,
        tables: inspectedTables,
        previousSnapshot: diffInfo,
    };
    if (ARG_JSON) {
        console.log(JSON.stringify(snapshot, null, 2));
    }
    if (!ARG_DRY_RUN) {
        if (!fs_1.default.existsSync(index_1.config.DATA_DIR)) {
            fs_1.default.mkdirSync(index_1.config.DATA_DIR, { recursive: true });
        }
        if (fs_1.default.existsSync(snapshotPath)) {
            try {
                fs_1.default.copyFileSync(snapshotPath, `${snapshotPath}.bak`);
            }
            catch { /* ignore */ }
        }
        const tmpPath = `${snapshotPath}.${Date.now()}.tmp`;
        try {
            fs_1.default.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
            fs_1.default.renameSync(tmpPath, snapshotPath);
            ok(`Snapshot written to: ${snapshotPath}`);
        }
        catch (e) {
            err(`Failed to write snapshot: ${e.message}`);
            if (fs_1.default.existsSync(tmpPath))
                try {
                    fs_1.default.unlinkSync(tmpPath);
                }
                catch { /* ignore */ }
        }
        if (!index_1.config.DB_NAME) {
            info(`Tip: Set DB_NAME=${activeDatabaseName} in .env to skip auto-discovery on future runs.`);
        }
    }
    else {
        warn('DRY RUN — no files written.');
    }
    if (diffInfo) {
        section('Changes Since Last Snapshot');
        if (diffInfo.newTables.length > 0) {
            console.log('  🆕 New tables:');
            diffInfo.newTables.forEach((n) => console.log(`     + ${n}`));
        }
        if (diffInfo.removedTables.length > 0) {
            console.log('  🗑️  Removed tables:');
            diffInfo.removedTables.forEach((n) => console.log(`     - ${n}`));
        }
        if (diffInfo.changedTables.length > 0) {
            console.log('  📝 Schema-changed tables (column count differs):');
            diffInfo.changedTables.forEach((n) => console.log(`     ~ ${n}`));
        }
        if (!diffInfo.newTables.length && !diffInfo.removedTables.length && !diffInfo.changedTables.length) {
            ok('No schema changes detected since last snapshot.');
        }
    }
    section('Done');
    ok('Database inspection complete.');
    if (!ARG_DRY_RUN) {
        info(`Snapshot:   ${snapshotPath}`);
        info(`Sync state: ${path_1.default.join(index_1.config.DATA_DIR, 'sync-state.json')}`);
    }
    console.log();
    await client_1.dbClient.close();
    process.exit(0);
}
main().catch((e) => {
    console.error('\n❌ Fatal error:', e.message || e);
    process.exit(1);
});
