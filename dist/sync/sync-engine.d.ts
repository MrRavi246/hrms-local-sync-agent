import { TableSchemaDiscovery } from '../database/schema-discovery';
export interface SyncRunResult {
    status: 'COMPLETED' | 'NO_NEW_RECORDS' | 'SKIPPED_IN_PROGRESS' | 'DRY_RUN' | 'FAILED';
    recordsRead: number;
    recordsSent: number;
    recordsInserted: number;
    recordsDuplicate: number;
    recordsRejected: number;
    cursorBefore: string | null;
    cursorAfter: string | null;
    error?: string;
}
export declare class SyncEngine {
    private static instance;
    private isSyncInProgress;
    private schema;
    private constructor();
    static getInstance(): SyncEngine;
    /**
     * Initializes schema discovery and sets cursor strategy
     */
    initialize(): Promise<TableSchemaDiscovery>;
    /**
     * Executes a single incremental synchronization pass
     */
    runSync(triggerSource?: string): Promise<SyncRunResult>;
    /**
     * Resets schema cache if table changes
     */
    resetSchemaCache(): void;
}
export declare const syncEngine: SyncEngine;
