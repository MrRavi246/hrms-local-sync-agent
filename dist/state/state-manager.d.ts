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
    seenBoundaryIds: string[];
    updatedAt: string;
}
export declare class StateManager {
    private static instance;
    private state;
    private stateFilePath;
    private backupFilePath;
    private sqliteDb;
    private isSqliteAvailable;
    private constructor();
    static getInstance(): StateManager;
    /**
     * Initializes SQLite database if available
     */
    private initSqlite;
    /**
     * Loads state from SQLite or atomic JSON file or backup file
     */
    private loadState;
    /**
     * Returns current sync state
     */
    getState(): Readonly<SyncStateData>;
    /**
     * Advances the sync cursor ONLY after HRMS confirms successful processing.
     */
    commitBatchSuccess(params: {
        nextCursor: string;
        insertedCount: number;
        boundaryRecordIds?: string[];
    }): void;
    /**
     * Records a sync failure without advancing cursor
     */
    recordSyncFailure(errorMessage: string): void;
    /**
     * Updates heartbeat status
     */
    recordHeartbeatSuccess(pendingRecords?: number): void;
    /**
     * Sets cursor strategy info
     */
    setCursorStrategy(column: string, type: 'identity' | 'primary_key' | 'timestamp' | 'custom'): void;
    /**
     * Resets sync cursor (diagnostic/recovery tool)
     */
    resetCursor(newCursor?: string | null): void;
    /**
     * Persists state to SQLite and atomic JSON file
     */
    private persist;
}
export declare const stateManager: StateManager;
