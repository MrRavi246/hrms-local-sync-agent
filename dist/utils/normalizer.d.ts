export interface NormalizedSyncRecord {
    sourceRecordId: string;
    employeeCode: string;
    logDateTime: string;
    direction?: 'In' | 'Out';
    deviceSerialNumber?: string;
    deviceIpAddress?: string;
    deviceId?: string;
    raw?: Record<string, any>;
}
/**
 * Normalizes raw SQL Server AttendanceLogs row into standard SyncRecordItem
 */
export declare function normalizeAttendanceRecord(row: Record<string, any>, primaryKeyCol?: string | null): NormalizedSyncRecord | null;
