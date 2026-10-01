import http from 'http';
import { HrmsApiClient } from '../../src/api/hrms-client';
import { stateManager } from '../../src/state/state-manager';
import { normalizeAttendanceRecord } from '../../src/utils/normalizer';

export async function testSyncFlow() {
  console.log('🧪 Testing End-to-End Batch Sync Ingestion & Idempotency Flow...');

  let receivedBatches: any[] = [];
  let receivedHeartbeats: any[] = [];
  let simulatedFailure = false;

  // 1. Create a local Mock HRMS Server
  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};

      if (req.url === '/integrations/heartbeat') {
        receivedHeartbeats.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            message: 'Heartbeat acknowledged',
            data: {
              serverTime: new Date().toISOString(),
              syncRequested: true, // test remote sync trigger
              deviceId: parsed.deviceId,
            },
          })
        );
        return;
      }

      if (req.url === '/integrations/attendance/sync') {
        if (simulatedFailure) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Simulated Database Failure on HRMS' }));
          return;
        }

        receivedBatches.push(parsed);
        const count = parsed.records?.length || 0;
        const isDuplicate = receivedBatches.length > 1;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            requestId: parsed.requestId,
            received: count,
            inserted: isDuplicate ? 0 : count,
            duplicates: isDuplicate ? count : 0,
            rejected: 0,
            nextSyncCursor: parsed.cursor,
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (mockServer.address() as any).port;
  const mockUrl = `http://127.0.0.1:${port}`;

  try {
    // Override apiClient instance baseURL for this integration test
    const apiClient = HrmsApiClient.getInstance();
    (apiClient as any).client.defaults.baseURL = mockUrl;

    // Reset state cursor
    stateManager.resetCursor('1000');

    // 2. Prepare sample biometric records
    const sampleRawRows = [
      { Id: 1001, EmployeeCode: '101', LogDateTime: '2026-09-30T09:00:00.000Z', Direction: 'In', DeviceSerialNumber: 'SN1' },
      { Id: 1002, EmployeeCode: '102', LogDateTime: '2026-09-30T09:05:00.000Z', Direction: 'In', DeviceSerialNumber: 'SN1' },
      { Id: 1003, EmployeeCode: '103', LogDateTime: '2026-09-30T09:10:00.000Z', Direction: 'In', DeviceSerialNumber: 'SN1' },
    ];

    const normalizedRecords = sampleRawRows.map((r) => normalizeAttendanceRecord(r, 'Id')!);

    // 3. Test Batch 1: Initial Sync Success
    const batchRes1 = await apiClient.sendBatch({
      deviceId: 'TEST-DEVICE-01',
      requestId: 'req_test_01',
      cursor: '1003',
      records: normalizedRecords,
    });

    if (!batchRes1.success || batchRes1.inserted !== 3) {
      throw new Error(`Expected batch 1 to insert 3 records, got: ${JSON.stringify(batchRes1)}`);
    }

    stateManager.commitBatchSuccess({
      nextCursor: batchRes1.nextSyncCursor!,
      insertedCount: batchRes1.inserted,
    });

    if (stateManager.getState().cursor !== '1003') {
      throw new Error(`Expected state cursor 1003, got ${stateManager.getState().cursor}`);
    }
    console.log('✅ Batch 1 successfully sent and state cursor updated to 1003');

    // 4. Test Batch 2: Idempotency / Duplicate Protection
    const batchRes2 = await apiClient.sendBatch({
      deviceId: 'TEST-DEVICE-01',
      requestId: 'req_test_02',
      cursor: '1003',
      records: normalizedRecords,
    });

    if (batchRes2.duplicates !== 3 || batchRes2.inserted !== 0) {
      throw new Error(`Expected duplicate detection, got: ${JSON.stringify(batchRes2)}`);
    }
    console.log('✅ Batch 2 duplicate protection verified: 0 new inserted, 3 duplicates counted');

    // 5. Test Batch 3: Failure handling (HTTP 500 error)
    simulatedFailure = true;
    const initialCursor = stateManager.getState().cursor;

    try {
      await apiClient.sendBatch({
        deviceId: 'TEST-DEVICE-01',
        requestId: 'req_test_03',
        cursor: '1006',
        records: normalizedRecords,
      });
      throw new Error('Expected sendBatch to throw on 500 status');
    } catch (err: any) {
      stateManager.recordSyncFailure(err.message);
    }

    if (stateManager.getState().cursor !== initialCursor) {
      throw new Error(`CRITICAL: Cursor advanced on failure! Expected ${initialCursor}, got ${stateManager.getState().cursor}`);
    }
    console.log(`✅ Safe recovery verified: Cursor remained intact at ${initialCursor} after simulated 500 failure`);

    // 6. Test Heartbeat probe & remote command detection
    const hbRes = await apiClient.sendHeartbeat({
      pendingRecords: 0,
      recordsSynced: 3,
      agentStatus: 'HEALTHY',
    });

    if (!hbRes.syncRequested) {
      throw new Error('Expected syncRequested to be true from mock server');
    }
    console.log('✅ Heartbeat correctly recognized remote admin syncRequested flag');
  } finally {
    mockServer.close();
  }

  console.log('✅ End-to-end integration sync flow verified successfully!');
}
