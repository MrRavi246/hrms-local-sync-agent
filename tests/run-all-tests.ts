import { testNormalizer } from './unit/normalizer.test';
import { testStateManager } from './unit/state-manager.test';
import { testApiClient } from './unit/api-client.test';
import { testSyncFlow } from './integration/sync-flow.test';

async function runAllTests() {
  console.log('======================================================================');
  console.log('  CMK HRMS: LOCAL SYNC AGENT AUTOMATED TEST SUITE');
  console.log('======================================================================\n');

  const startTime = Date.now();
  let passedCount = 0;

  try {
    await testNormalizer();
    passedCount++;
    console.log();

    await testStateManager();
    passedCount++;
    console.log();

    await testApiClient();
    passedCount++;
    console.log();

    await testSyncFlow();
    passedCount++;
    console.log();

    const elapsed = Date.now() - startTime;
    console.log('======================================================================');
    console.log(`🎉 ALL ${passedCount} TEST SUITES PASSED SUCCESSFULLY in ${elapsed}ms!`);
    console.log('======================================================================\n');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ TEST SUITE FAILED:');
    console.error(err);
    process.exit(1);
  }
}

runAllTests();
