"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAttendanceRecord = normalizeAttendanceRecord;
const hash_1 = require("./hash");
/**
 * Normalizes raw SQL Server AttendanceLogs row into standard SyncRecordItem
 */
function normalizeAttendanceRecord(row, primaryKeyCol) {
    if (!row || typeof row !== 'object')
        return null;
    // 1. Resolve EmployeeCode
    const employeeCode = row.EmployeeCode ??
        row.employeecode ??
        row.EmpCode ??
        row.empcode ??
        row.EmpId ??
        row.empid ??
        row.UserId ??
        row.userid ??
        row.EnrollNumber ??
        row.EnrollNo ??
        row.CardNo ??
        row.cardno ??
        row.Badgenumber;
    if (employeeCode === undefined || employeeCode === null || String(employeeCode).trim() === '') {
        return null;
    }
    const cleanEmpCode = String(employeeCode).trim();
    // 2. Resolve Timestamp (PunchDatetime, LogDateTime, or LogDate + LogTime)
    let parsedDate = null;
    const rawDateTime = row.PunchDatetime ??
        row.PunchDateTime ??
        row.punchdatetime ??
        row.PunchDate ??
        row.punchdate ??
        row.LogDateTime ??
        row.logdatetime ??
        row.LogDateTime2 ??
        row.DownloadDateTime;
    if (rawDateTime) {
        parsedDate = rawDateTime instanceof Date ? rawDateTime : new Date(rawDateTime);
    }
    else if ((row.LogDate || row.PunchDate) && (row.LogTime || row.PunchTime)) {
        // Combine separate date and time columns
        const dVal = row.LogDate || row.PunchDate;
        const tVal = row.LogTime || row.PunchTime;
        const dateStr = dVal instanceof Date ? dVal.toISOString().split('T')[0] : String(dVal).trim();
        const timeStr = tVal instanceof Date ? tVal.toTimeString().split(' ')[0] : String(tVal).trim();
        parsedDate = new Date(`${dateStr} ${timeStr}`);
    }
    if (!parsedDate || isNaN(parsedDate.getTime())) {
        return null;
    }
    const formattedDateTime = parsedDate.toISOString();
    // 3. Resolve Direction ('In' or 'Out')
    let direction;
    const rawDirection = String(row.Direction ?? row.direction ?? row.InOut ?? row.inout ?? row.Type ?? '').trim().toLowerCase();
    if (rawDirection === 'in' || rawDirection === '1' || rawDirection === 'checkin' || rawDirection === 'i') {
        direction = 'In';
    }
    else if (rawDirection === 'out' || rawDirection === '2' || rawDirection === 'checkout' || rawDirection === 'o') {
        direction = 'Out';
    }
    // 4. Resolve Device metadata
    const deviceSerialNumber = row.DeviceSerialNumber ?? row.deviceserialnumber ?? row.SerialNumber ?? row.DevSN;
    const deviceIpAddress = row.DeviceipAddress ?? row.deviceipaddress ?? row.DeviceIP ?? row.IpAddress;
    const deviceId = row.DeviceId ?? row.deviceid ?? row.DevId;
    // 5. Resolve sourceRecordId
    let sourceRecordId;
    if (primaryKeyCol && row[primaryKeyCol] !== undefined && row[primaryKeyCol] !== null) {
        sourceRecordId = String(row[primaryKeyCol]).trim();
    }
    else {
        // Fallback: Generate deterministic hash from unique attributes
        sourceRecordId = (0, hash_1.generateDeterministicRecordId)({
            employeeCode: cleanEmpCode,
            logDateTime: formattedDateTime,
            direction,
            deviceSerialNumber: deviceSerialNumber ? String(deviceSerialNumber).trim() : undefined,
            deviceId: deviceId ? String(deviceId).trim() : undefined,
        });
    }
    // Clean raw row for payload (strip buffers / large binary fields)
    const cleanRaw = {};
    for (const [k, v] of Object.entries(row)) {
        if (Buffer.isBuffer(v))
            continue;
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
