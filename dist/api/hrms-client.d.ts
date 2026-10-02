import { NormalizedSyncRecord } from '../utils/normalizer';
export interface HeartbeatRequest {
    deviceId: string;
    agentVersion: string;
    hostname: string;
    osInfo: string;
    pendingRecords: number;
    recordsSynced: number;
    agentStatus: string;
}
export interface HeartbeatResponse {
    success: boolean;
    serverTime: string;
    syncRequested: boolean;
    deviceId: string;
}
export interface SyncBatchRequest {
    deviceId: string;
    requestId: string;
    cursor: string | null;
    records: NormalizedSyncRecord[];
}
export interface SyncBatchResponse {
    success: boolean;
    requestId: string;
    received: number;
    inserted: number;
    duplicates: number;
    rejected: number;
    nextSyncCursor?: string;
    message?: string;
}
export declare class HrmsApiClient {
    private static instance;
    private client;
    readonly agentVersion = "1.0.0";
    private rateLimitedUntil;
    isRateLimited(): boolean;
    getRateLimitRemainingSeconds(): number;
    private constructor();
    static getInstance(): HrmsApiClient;
    /**
     * Sends heartbeat ping to HRMS server
     */
    sendHeartbeat(params: {
        pendingRecords: number;
        recordsSynced: number;
        agentStatus: string;
    }): Promise<HeartbeatResponse>;
    /**
     * Dispatches a batch of normalized attendance records to the HRMS API
     */
    sendBatch(payload: SyncBatchRequest): Promise<SyncBatchResponse>;
    /**
     * Tests outbound connectivity to HRMS health or root endpoint
     */
    testConnection(): Promise<{
        ok: boolean;
        status: number;
        message: string;
    }>;
    /**
     * Structured error logging without leaking secrets
     */
    private handleApiError;
}
export declare const hrmsApiClient: HrmsApiClient;
