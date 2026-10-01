import { normalizeAttendanceRecord } from '../../src/utils/normalizer';
import { generateDeterministicRecordId, sha256 } from '../../src/utils/hash';

export async function testNormalizer() {
  console.log('🧪 Testing Record Normalizer & Hashing...');

  // Test 1: Standard vendor record with primary key
  const row1 = {
    Id: 1001,
    EmployeeCode: 'EMP001',
    LogDateTime: '2026-09-30T09:15:00.000Z',
    Direction: 'In',
    DeviceSerialNumber: 'SN12345',
    DeviceipAddress: '192.168.1.10',
    DeviceId: 'DEV1',
  };

  const norm1 = normalizeAttendanceRecord(row1, 'Id');
  if (!norm1) throw new Error('Expected norm1 to be non-null');
  if (norm1.sourceRecordId !== '1001') throw new Error(`Expected sourceRecordId 1001, got ${norm1.sourceRecordId}`);
  if (norm1.employeeCode !== 'EMP001') throw new Error(`Expected employeeCode EMP001, got ${norm1.employeeCode}`);
  if (norm1.direction !== 'In') throw new Error(`Expected direction In, got ${norm1.direction}`);

  // Test 2: Vendor record with separate LogDate and LogTime and no PK (deterministic hash)
  const row2 = {
    EmployeeCode: '100',
    LogDate: '2026-09-30',
    LogTime: '17:45:00',
    Direction: '2', // 2 means Out
    SerialNumber: 'SN99999',
  };

  const norm2 = normalizeAttendanceRecord(row2, null);
  if (!norm2) throw new Error('Expected norm2 to be non-null');
  if (!norm2.sourceRecordId.startsWith('hash_')) throw new Error(`Expected deterministic hash, got ${norm2.sourceRecordId}`);
  if (norm2.direction !== 'Out') throw new Error(`Expected direction Out, got ${norm2.direction}`);

  // Test 3: Deterministic hash uniqueness and repeatability
  const hashA = generateDeterministicRecordId({
    employeeCode: 'EMP001',
    logDateTime: '2026-09-30T09:00:00.000Z',
    direction: 'In',
    deviceSerialNumber: 'SN1',
  });

  const hashB = generateDeterministicRecordId({
    employeeCode: 'EMP001',
    logDateTime: '2026-09-30T09:00:00.000Z',
    direction: 'In',
    deviceSerialNumber: 'SN1',
  });

  const hashC = generateDeterministicRecordId({
    employeeCode: 'EMP002', // different employee
    logDateTime: '2026-09-30T09:00:00.000Z',
    direction: 'In',
    deviceSerialNumber: 'SN1',
  });

  if (hashA !== hashB) throw new Error('Deterministic hash must be reproducible');
  if (hashA === hashC) throw new Error('Different employees must produce different hashes');

  // Test 4: Missing EmployeeCode or invalid date should return null
  const invalidRow1 = { Direction: 'In', LogDateTime: '2026-09-30' }; // missing code
  const invalidRow2 = { EmployeeCode: '100', LogDateTime: 'invalid-date' };

  if (normalizeAttendanceRecord(invalidRow1, 'Id') !== null) {
    throw new Error('Should reject row with missing EmployeeCode');
  }
  if (normalizeAttendanceRecord(invalidRow2, 'Id') !== null) {
    throw new Error('Should reject row with invalid timestamp');
  }

  console.log('✅ Normalizer and hashing tests passed successfully!');
}
