import fs from 'fs';
import path from 'path';
import { stateManager } from '../../src/state/state-manager';
import { config } from '../../src/config/index';

export async function testStateManager() {
  console.log('🧪 Testing State Manager Persistence & Atomic Operations...');

  // Reset to known state
  stateManager.resetCursor(null);
  let state = stateManager.getState();
  if (state.cursor !== null) throw new Error('Initial cursor should be null');

  // Test 1: Commit batch success advances cursor
  stateManager.commitBatchSuccess({
    nextCursor: '1050',
    insertedCount: 50,
    boundaryRecordIds: ['rec_1', 'rec_2'],
  });

  state = stateManager.getState();
  if (state.cursor !== '1050') throw new Error(`Expected cursor 1050, got ${state.cursor}`);
  if (state.totalRecordsSynced < 50) throw new Error(`Expected at least 50 synced records, got ${state.totalRecordsSynced}`);
  if (state.consecutiveFailures !== 0) throw new Error('Failures should be reset to 0');

  // Test 2: Failure recording does NOT advance cursor
  stateManager.recordSyncFailure('Simulated HRMS 500 error');
  state = stateManager.getState();
  if (state.cursor !== '1050') throw new Error(`Cursor advanced after failure! Expected 1050, got ${state.cursor}`);
  if (state.consecutiveFailures !== 1) throw new Error(`Expected 1 consecutive failure, got ${state.consecutiveFailures}`);
  if (state.lastError !== 'Simulated HRMS 500 error') throw new Error('Last error message was not recorded');

  // Test 3: Verify JSON persistence on disk
  const stateFilePath = path.join(config.DATA_DIR, 'sync-state.json');
  if (!fs.existsSync(stateFilePath)) {
    throw new Error(`State file ${stateFilePath} was not created`);
  }
  const fileContent = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
  if (fileContent.cursor !== '1050') {
    throw new Error(`Persisted cursor in JSON file was ${fileContent.cursor}, expected 1050`);
  }

  // Test 4: Commit next batch
  stateManager.commitBatchSuccess({
    nextCursor: '1100',
    insertedCount: 50,
  });
  state = stateManager.getState();
  if (state.cursor !== '1100') throw new Error(`Expected cursor 1100, got ${state.cursor}`);
  if (state.consecutiveFailures !== 0) throw new Error('Failures should reset on success');

  console.log('✅ State Manager tests passed successfully!');
}
