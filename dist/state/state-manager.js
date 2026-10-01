"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stateManager = exports.StateManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
const DEFAULT_STATE = {
    cursor: null,
    cursorColumn: null,
    cursorType: null,
    lastSyncAt: null,
    lastSuccessfulBatchCount: 0,
    totalRecordsSynced: 0,
    pendingRecords: 0,
    lastHeartbeatAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    agentStatus: 'HEALTHY',
    seenBoundaryIds: [],
    updatedAt: new Date().toISOString(),
};
class StateManager {
    static instance;
    state;
    stateFilePath;
    backupFilePath;
    sqliteDb = null;
    isSqliteAvailable = false;
    constructor() {
        // Ensure data directory exists
        if (!fs_1.default.existsSync(index_1.config.DATA_DIR)) {
            fs_1.default.mkdirSync(index_1.config.DATA_DIR, { recursive: true });
        }
        this.stateFilePath = path_1.default.join(index_1.config.DATA_DIR, 'sync-state.json');
        this.backupFilePath = path_1.default.join(index_1.config.DATA_DIR, 'sync-state.json.bak');
        this.initSqlite();
        this.state = this.loadState();
    }
    static getInstance() {
        if (!StateManager.instance) {
            StateManager.instance = new StateManager();
        }
        return StateManager.instance;
    }
    /**
     * Initializes SQLite database if available
     */
    initSqlite() {
        try {
            // Dynamic require so if native build fails, app continues smoothly
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Database = require('better-sqlite3');
            const sqlitePath = path_1.default.join(index_1.config.DATA_DIR, 'sync-agent.sqlite3');
            this.sqliteDb = new Database(sqlitePath);
            this.sqliteDb.pragma('journal_mode = WAL');
            // Create state and history tables
            this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state_json TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS synced_record_keys (
          source_record_id TEXT PRIMARY KEY,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_synced_record_keys_synced_at ON synced_record_keys (synced_at);
      `);
            this.isSqliteAvailable = true;
            index_2.logger.debug('Local SQLite persistent store initialized successfully in WAL mode.');
        }
        catch (err) {
            this.isSqliteAvailable = false;
            index_2.logger.warn(`SQLite initialization skipped (${err.message}). Using atomic JSON state store.`);
        }
    }
    /**
     * Loads state from SQLite or atomic JSON file or backup file
     */
    loadState() {
        // 1. Try SQLite first
        if (this.isSqliteAvailable && this.sqliteDb) {
            try {
                const row = this.sqliteDb.prepare('SELECT state_json FROM sync_state WHERE id = 1').get();
                if (row && row.state_json) {
                    const parsed = JSON.parse(row.state_json);
                    index_2.logger.info(`Loaded persistent sync state from SQLite. Last cursor: ${parsed.cursor ?? 'NONE'}`);
                    return { ...DEFAULT_STATE, ...parsed };
                }
            }
            catch (err) {
                index_2.logger.warn(`Could not read state from SQLite: ${err.message}. Checking JSON file.`);
            }
        }
        // 2. Try JSON state file
        if (fs_1.default.existsSync(this.stateFilePath)) {
            try {
                const content = fs_1.default.readFileSync(this.stateFilePath, 'utf-8');
                const parsed = JSON.parse(content);
                index_2.logger.info(`Loaded persistent sync state from JSON file. Last cursor: ${parsed.cursor ?? 'NONE'}`);
                return { ...DEFAULT_STATE, ...parsed };
            }
            catch (err) {
                index_2.logger.error(`Error reading ${this.stateFilePath}: ${err.message}. Attempting recovery from backup.`);
            }
        }
        // 3. Try backup JSON file
        if (fs_1.default.existsSync(this.backupFilePath)) {
            try {
                const content = fs_1.default.readFileSync(this.backupFilePath, 'utf-8');
                const parsed = JSON.parse(content);
                index_2.logger.warn(`Recovered sync state from backup file. Last cursor: ${parsed.cursor ?? 'NONE'}`);
                return { ...DEFAULT_STATE, ...parsed };
            }
            catch (err) {
                index_2.logger.error(`Error recovering from backup ${this.backupFilePath}: ${err.message}`);
            }
        }
        index_2.logger.info('No previous sync state found. Initializing fresh sync state at origin.');
        return { ...DEFAULT_STATE };
    }
    /**
     * Returns current sync state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Advances the sync cursor ONLY after HRMS confirms successful processing.
     */
    commitBatchSuccess(params) {
        const now = new Date().toISOString();
        this.state.cursor = params.nextCursor;
        this.state.lastSyncAt = now;
        this.state.lastSuccessfulBatchCount = params.insertedCount;
        this.state.totalRecordsSynced += params.insertedCount;
        this.state.consecutiveFailures = 0;
        this.state.lastError = null;
        this.state.agentStatus = 'HEALTHY';
        this.state.updatedAt = now;
        if (params.boundaryRecordIds && params.boundaryRecordIds.length > 0) {
            // Keep only recent 500 boundary IDs to prevent unlimited memory growth
            const combined = [...this.state.seenBoundaryIds, ...params.boundaryRecordIds];
            this.state.seenBoundaryIds = combined.slice(-500);
        }
        this.persist();
        // Record individual synced record keys in SQLite for local fast lookups
        if (this.isSqliteAvailable && this.sqliteDb && params.boundaryRecordIds) {
            try {
                const insertStmt = this.sqliteDb.prepare('INSERT OR IGNORE INTO synced_record_keys (source_record_id) VALUES (?)');
                const transaction = this.sqliteDb.transaction((ids) => {
                    for (const id of ids) {
                        insertStmt.run(id);
                    }
                });
                transaction(params.boundaryRecordIds);
            }
            catch (err) {
                index_2.logger.debug(`SQLite batch key insert: ${err.message}`);
            }
        }
    }
    /**
     * Records a sync failure without advancing cursor
     */
    recordSyncFailure(errorMessage) {
        const now = new Date().toISOString();
        this.state.consecutiveFailures += 1;
        this.state.lastError = errorMessage;
        this.state.lastErrorAt = now;
        this.state.agentStatus = this.state.consecutiveFailures > 3 ? 'BACKOFF' : 'ERROR';
        this.state.updatedAt = now;
        this.persist();
    }
    /**
     * Updates heartbeat status
     */
    recordHeartbeatSuccess(pendingRecords) {
        const now = new Date().toISOString();
        this.state.lastHeartbeatAt = now;
        if (typeof pendingRecords === 'number') {
            this.state.pendingRecords = pendingRecords;
        }
        if (this.state.agentStatus === 'BACKOFF' && this.state.consecutiveFailures === 0) {
            this.state.agentStatus = 'HEALTHY';
        }
        this.state.updatedAt = now;
        this.persist();
    }
    /**
     * Sets cursor strategy info
     */
    setCursorStrategy(column, type) {
        if (this.state.cursorColumn !== column || this.state.cursorType !== type) {
            this.state.cursorColumn = column;
            this.state.cursorType = type;
            this.state.updatedAt = new Date().toISOString();
            this.persist();
        }
    }
    /**
     * Resets sync cursor (diagnostic/recovery tool)
     */
    resetCursor(newCursor = null) {
        this.state.cursor = newCursor;
        this.state.seenBoundaryIds = [];
        this.state.updatedAt = new Date().toISOString();
        this.persist();
        index_2.logger.warn(`Sync cursor reset manually to: ${newCursor ?? 'NULL (Origin)'}`);
    }
    /**
     * Persists state to SQLite and atomic JSON file
     */
    persist() {
        const jsonString = JSON.stringify(this.state, null, 2);
        // 1. Persist to SQLite
        if (this.isSqliteAvailable && this.sqliteDb) {
            try {
                this.sqliteDb
                    .prepare('INSERT INTO sync_state (id, state_json, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP')
                    .run(jsonString);
            }
            catch (err) {
                index_2.logger.error(`Failed to write state to SQLite: ${err.message}`);
            }
        }
        // 2. Persist atomically to JSON file
        // Write to a temporary file first, then atomically rename to prevent corruption on crash
        const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
        try {
            fs_1.default.writeFileSync(tempFile, jsonString, 'utf-8');
            // Make a copy as backup if primary exists
            if (fs_1.default.existsSync(this.stateFilePath)) {
                try {
                    fs_1.default.copyFileSync(this.stateFilePath, this.backupFilePath);
                }
                catch {
                    // ignore backup copy errors
                }
            }
            // Atomic rename
            fs_1.default.renameSync(tempFile, this.stateFilePath);
        }
        catch (err) {
            index_2.logger.error(`Failed to save state to ${this.stateFilePath}: ${err.message}`);
            if (fs_1.default.existsSync(tempFile)) {
                try {
                    fs_1.default.unlinkSync(tempFile);
                }
                catch {
                    // ignore
                }
            }
        }
    }
}
exports.StateManager = StateManager;
exports.stateManager = StateManager.getInstance();
