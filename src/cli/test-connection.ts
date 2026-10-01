import { config } from '../config/index';
import { dbClient } from '../database/client';
import { hrmsApiClient } from '../api/hrms-client';

async function testConnection() {
  console.log('Testing connectivity for CMK HRMS Local Sync Agent...\n');

  console.log('1. Checking SQL Server Express...');
  const dbPing = await dbClient.ping();
  if (dbPing.connected) {
    console.log(`✅ SQL Server reachable (${dbPing.latencyMs}ms)`);
  } else {
    console.log(`❌ SQL Server unreachable: ${dbPing.error}`);
    if (dbPing.error && dbPing.error.includes('Failed to connect') && dbPing.error.includes('ms')) {
      console.log('\n  💡 TIP: SQL Server Browser service may be STOPPED or TCP/IP DISABLED.');
      console.log('     Run as Administrator: scripts\\fix-sql-connection.bat');
    }
  }

  console.log('\n2. Checking HRMS API...');
  const hrmsPing = await hrmsApiClient.testConnection();
  if (hrmsPing.ok) {
    console.log(`✅ HRMS API reachable at ${config.HRMS_API_URL} (Status: ${hrmsPing.status})`);
  } else {
    console.log(`❌ HRMS API unreachable: ${hrmsPing.message}`);
  }

  await dbClient.close();
  process.exit(dbPing.connected && hrmsPing.ok ? 0 : 1);
}

testConnection();
