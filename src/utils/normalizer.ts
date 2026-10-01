import { generateDeterministicRecordId } from './hash';

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
export function normalizeAttendanceRecord(
  row: Record<string, any>,
  primaryKeyCol?: string | null
): NormalizedSyncRecord | null {
  if (!row || typeof row !== 'object') return null;

  // 1. Resolve EmployeeCode
  const employeeCode =
    row.EmployeeCode ??
    row.employeecode ??
    row.EmpCode ??
    row.empcode ??
    row.UserId ??
    row.userid ??
    row.EnrollNumber ??
    row.CardNo ??
    row.Badgenumber;

  if (employeeCode === undefined || employeeCode === null || String(employeeCode).trim() === '') {
    return null;
  }
  const cleanEmpCode = String(employeeCode).trim();

  // 2. Resolve Timestamp (LogDateTime or LogDate + LogTime)
  let parsedDate: Date | null = null;
  const rawDateTime = row.LogDateTime ?? row.logdatetime ?? row.LogDateTime2 ?? row.DownloadDateTime;

  if (rawDateTime) {
    parsedDate = rawDateTime instanceof Date ? rawDateTime : new Date(rawDateTime);
  } else if (row.LogDate && row.LogTime) {
    // Combine separate date and time columns
    const dateStr = row.LogDate instanceof Date ? row.LogDate.toISOString().split('T')[0] : String(row.LogDate).trim();
    const timeStr = row.LogTime instanceof Date ? row.LogTime.toTimeString().split(' ')[0] : String(row.LogTime).trim();
    parsedDate = new Date(`${dateStr} ${timeStr}`);
  }

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return null;
  }

  const formattedDateTime = parsedDate.toISOString();

  // 3. Resolve Direction ('In' or 'Out')
  let direction: 'In' | 'Out' | undefined;
  const rawDirection = String(row.Direction ?? row.direction ?? row.Type ?? '').trim().toLowerCase();

  if (rawDirection === 'in' || rawDirection === '1' || rawDirection === 'checkin' || rawDirection === 'i') {
    direction = 'In';
  } else if (rawDirection === 'out' || rawDirection === '2' || rawDirection === 'checkout' || rawDirection === 'o') {
    direction = 'Out';
  }

  // 4. Resolve Device metadata
  const deviceSerialNumber = row.DeviceSerialNumber ?? row.deviceserialnumber ?? row.SerialNumber ?? row.DevSN;
  const deviceIpAddress = row.DeviceipAddress ?? row.deviceipaddress ?? row.DeviceIP ?? row.IpAddress;
  const deviceId = row.DeviceId ?? row.deviceid ?? row.DevId;

  // 5. Resolve sourceRecordId
  let sourceRecordId: string;
  if (primaryKeyCol && row[primaryKeyCol] !== undefined && row[primaryKeyCol] !== null) {
    sourceRecordId = String(row[primaryKeyCol]).trim();
  } else {
    // Fallback: Generate deterministic hash from unique attributes
    sourceRecordId = generateDeterministicRecordId({
      employeeCode: cleanEmpCode,
      logDateTime: formattedDateTime,
      direction,
      deviceSerialNumber: deviceSerialNumber ? String(deviceSerialNumber).trim() : undefined,
      deviceId: deviceId ? String(deviceId).trim() : undefined,
    });
  }

  // Clean raw row for payload (strip buffers / large binary fields)
  const cleanRaw: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) continue;
    cleanRaw[k] = v instanceof Date ? v.toISOString() : v;
  }

  return {
    sourceRecordId,
    employeeCode: cleanEmpCode,
    logDateTime: formattedDateTime,
    direction,
    deviceSerialNumber: deviceSerialNumber ? String(deviceSerialNumber).trim() : undefined,
    deviceIpAddress: deviceIpAddress ? String(deviceIpAddress).trim() : undefined,
    deviceId: deviceId ? String(deviceId).trim() : undefined,
    raw: cleanRaw,
  };
}
