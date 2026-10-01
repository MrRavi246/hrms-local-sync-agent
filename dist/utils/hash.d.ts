/**
 * Computes a deterministic SHA-256 hash string from input data
 */
export declare function sha256(input: string): string;
/**
 * Generates a deterministic, collision-resistant sourceRecordId for an attendance punch
 * when the source database does not have an explicit primary key / identity column.
 */
export declare function generateDeterministicRecordId(fields: {
    employeeCode: string;
    logDateTime: string;
    direction?: string;
    deviceSerialNumber?: string;
    deviceId?: string;
}): string;
