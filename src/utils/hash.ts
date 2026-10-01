import crypto from 'crypto';

/**
 * Computes a deterministic SHA-256 hash string from input data
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input.trim()).digest('hex');
}

/**
 * Generates a deterministic, collision-resistant sourceRecordId for an attendance punch
 * when the source database does not have an explicit primary key / identity column.
 */
export function generateDeterministicRecordId(fields: {
  employeeCode: string;
  logDateTime: string;
  direction?: string;
  deviceSerialNumber?: string;
  deviceId?: string;
}): string {
  const parts = [
    fields.employeeCode.trim().toUpperCase(),
    fields.logDateTime.trim(),
    (fields.direction || 'IN').trim().toUpperCase(),
    (fields.deviceSerialNumber || '').trim().toUpperCase(),
    (fields.deviceId || '').trim().toUpperCase(),
  ];

  const rawKey = parts.join('|');
  const hashDigest = sha256(rawKey).slice(0, 32);
  return `hash_${hashDigest}`;
}
