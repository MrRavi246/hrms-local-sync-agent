import fs from 'fs';
import path from 'path';
import { config } from '../config/index';
import { logger } from '../logger/index';

export interface SyncStateData {
  cursor: string | null;
  cursorColumn: string | null;
  cursorType: 'identity' | 'primary_key' | 'timestamp' | 'custom' | null;
  lastSyncAt: string | null;
  lastSuccessfulBatchCount: number;
  totalRecordsSynced: number;
  pendingRecords: number;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  agentStatus: 'HEALTHY' | 'SYNCING' | 'BACKOFF' | 'ERROR';
  seenBoundaryIds: string[]; // Recent IDs at the timestamp boundary to avoid duplicate queries
  updatedAt: string;
}

const DEFAULT_STATE: SyncStateData = {
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

export class StateManager {
  private static instance: StateManager;
  private state: SyncStateData;
  private stateFilePath: string;
  private backupFilePath: string;
  private sqliteDb: any = null;
  private isSqliteAvailable = false;

  private constructor() {
    // Ensure data directory exists
    if (!fs.existsSync(config.DATA_DIR)) {
      fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }

    this.stateFilePath = path.join(config.DATA_DIR, 'sync-state.json');
    this.backupFilePath = path.join(config.DATA_DIR, 'sync-state.json.bak');

    this.initSqlite();
    this.state = this.loadState();
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  /**
   * Initializes SQLite database if available
   */
  private initSqlite(): void {
    try {
      // Dynamic require so if native build fails, app continues smoothly
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const sqlitePath = path.join(config.DATA_DIR, 'sync-agent.sqlite3');
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
      logger.debug('Local SQLite persistent store initialized successfully in WAL mode.');
    } catch (err: any) {
      this.isSqliteAvailable = false;
      logger.warn(`SQLite initialization skipped (${err.message}). Using atomic JSON state store.`);
    }
  }

  /**
   * Loads state from SQLite or atomic JSON file or backup file
   */
  private loadState(): SyncStateData {
    // 1. Try SQLite first
    if (this.isSqliteAvailable && this.sqliteDb) {
      try {
        const row = this.sqliteDb.prepare('SELECT state_json FROM sync_state WHERE id = 1').get();
        if (row && row.state_json) {
          const parsed = JSON.parse(row.state_json);
          logger.info(`Loaded persistent sync state from SQLite. Last cursor: ${parsed.cursor ?? 'NONE'}`);
          return { ...DEFAULT_STATE, ...parsed };
        }
      } catch (err: any) {
        logger.warn(`Could not read state from SQLite: ${err.message}. Checking JSON file.`);
      }
    }

    // 2. Try JSON state file
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const content = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(content);
        logger.info(`Loaded persistent sync state from JSON file. Last cursor: ${parsed.cursor ?? 'NONE'}`);
        return { ...DEFAULT_STATE, ...parsed };
      } catch (err: any) {
        logger.error(`Error reading ${this.stateFilePath}: ${err.message}. Attempting recovery from backup.`);
      }
    }

    // 3. Try backup JSON file
    if (fs.existsSync(this.backupFilePath)) {
      try {
        const content = fs.readFileSync(this.backupFilePath, 'utf-8');
        const parsed = JSON.parse(content);
        logger.warn(`Recovered sync state from backup file. Last cursor: ${parsed.cursor ?? 'NONE'}`);
        return { ...DEFAULT_STATE, ...parsed };
      } catch (err: any) {
        logger.error(`Error recovering from backup ${this.backupFilePath}: ${err.message}`);
      }
    }

    logger.info('No previous sync state found. Initializing fresh sync state at origin.');
    return { ...DEFAULT_STATE };
  }

  /**
   * Returns current sync state
   */
  public getState(): Readonly<SyncStateData> {
    return { ...this.state };
  }

  /**
   * Advances the sync cursor ONLY after HRMS confirms successful processing.
   */
  public commitBatchSuccess(params: {
    nextCursor: string;
    insertedCount: number;
    boundaryRecordIds?: string[];
  }): void {
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
        const insertStmt = this.sqliteDb.prepare(
          'INSERT OR IGNORE INTO synced_record_keys (source_record_id) VALUES (?)'
        );
        const transaction = this.sqliteDb.transaction((ids: string[]) => {
          for (const id of ids) {
            insertStmt.run(id);
          }
        });
        transaction(params.boundaryRecordIds);
      } catch (err: any) {
        logger.debug(`SQLite batch key insert: ${err.message}`);
      }
    }
  }

  /**
   * Records a sync failure without advancing cursor
   */
  public recordSyncFailure(errorMessage: string): void {
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
  public recordHeartbeatSuccess(pendingRecords?: number): void {
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
  public setCursorStrategy(column: string, type: 'identity' | 'primary_key' | 'timestamp' | 'custom'): void {
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
  public resetCursor(newCursor: string | null = null): void {
    this.state.cursor = newCursor;
    this.state.seenBoundaryIds = [];
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    logger.warn(`Sync cursor reset manually to: ${newCursor ?? 'NULL (Origin)'}`);
  }

  /**
   * Persists state to SQLite and atomic JSON file
   */
  private persist(): void {
    const jsonString = JSON.stringify(this.state, null, 2);

    // 1. Persist to SQLite
    if (this.isSqliteAvailable && this.sqliteDb) {
      try {
        this.sqliteDb
          .prepare(
            'INSERT INTO sync_state (id, state_json, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP'
          )
          .run(jsonString);
      } catch (err: any) {
        logger.error(`Failed to write state to SQLite: ${err.message}`);
      }
    }

    // 2. Persist atomically to JSON file
    // Write to a temporary file first, then atomically rename to prevent corruption on crash
    const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempFile, jsonString, 'utf-8');

      // Make a copy as backup if primary exists
      if (fs.existsSync(this.stateFilePath)) {
        try {
          fs.copyFileSync(this.stateFilePath, this.backupFilePath);
        } catch {
          // ignore backup copy errors
        }
      }

      // Atomic rename
      fs.renameSync(tempFile, this.stateFilePath);
    } catch (err: any) {
      logger.error(`Failed to save state to ${this.stateFilePath}: ${err.message}`);
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // ignore
        }
      }
    }
  }
}

export const stateManager = StateManager.getInstance();
