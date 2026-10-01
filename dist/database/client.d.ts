import mssql from 'mssql';
export declare class DatabaseClient {
    private static instance;
    private pools;
    private isConnecting;
    private connectionAttempts;
    private constructor();
    static getInstance(): DatabaseClient;
    /**
     * Generates mssql configuration object
     */
    private getMssqlConfig;
    /**
     * Connects to SQL Server with exponential backoff on failure
     */
    getPool(overrideDbName?: string): Promise<mssql.ConnectionPool>;
    /**
     * Pings the SQL Server connection to verify liveness
     */
    ping(): Promise<{
        connected: boolean;
        latencyMs?: number;
        error?: string;
    }>;
    /**
     * Gracefully closes all database connection pools
     */
    close(): Promise<void>;
}
export declare const dbClient: DatabaseClient;
