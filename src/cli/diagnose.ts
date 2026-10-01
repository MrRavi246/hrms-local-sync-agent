import { config } from '../config/index';
import { dbClient } from '../database/client';
import { SchemaDiscoveryService } from '../database/schema-discovery';
import { hrmsApiClient } from '../api/hrms-client';

async function runDiagnose() {
  console.log('======================================================================');
  console.log('  CMK HRMS: LOCAL BIOMETRIC SQL SERVER DIAGNOSTIC & DISCOVERY TOOL');
  console.log('======================================================================\n');

  console.log('Configuration Settings:');
  if (config.DB_CONNECTION_STRING) {
    console.log(`  - DB_CONNECTION_STRING: (Configured - credentials protected)`);
  }
  console.log(`  - DB_SERVER:        ${config.DB_SERVER}`);
  console.log(`  - DB_INSTANCE:      ${config.DB_INSTANCE}`);
  console.log(`  - DB_NAME:          ${config.DB_NAME || '(Will auto-discover)'}`);
  console.log(`  - DB_USER:          ${config.DB_USER}`);
  console.log(`  - DB_PASSWORD:      ${config.DB_PASSWORD ? '********' : '(NOT CONFIGURED)'}`);
  console.log(`  - DB_ENCRYPT:       ${config.DB_ENCRYPT}`);
  console.log(`  - DB_TRUST_CERT:    ${config.DB_TRUST_SERVER_CERTIFICATE}`);
  console.log(`  - SOURCE_TABLE:     ${config.SOURCE_TABLE}`);
  console.log(`  - HRMS_API_URL:     ${config.HRMS_API_URL}`);
  console.log(`  - SYNC_TOKEN:       ${config.SYNC_TOKEN ? `${config.SYNC_TOKEN.slice(0, 12)}...` : '(NOT CONFIGURED)'}`);
  console.log(`  - DEVICE_ID:        ${config.DEVICE_ID}\n`);

  // 1. Test SQL Server Connectivity
  console.log('--- Step 1: Testing Local SQL Server Express Connection ---');
  try {
    const ping = await dbClient.ping();
    if (ping.connected) {
      console.log(`✅ SQL Server Express is reachable! Latency: ${ping.latencyMs}ms\n`);
    } else {
      console.error(`❌ SQL Server connection failed: ${ping.error}`);
    }
  } catch (err: any) {
    console.error(`❌ Could not connect to SQL Server: ${err.message}`);
    console.log('Tip: Ensure SQL Server Express service is running and TCP/IP is enabled in SQL Server Configuration Manager.\n');
  }

  // 2. Discover Databases
  console.log('--- Step 2: Listing User Databases on SQL Server ---');
  try {
    const dbs = await SchemaDiscoveryService.discoverDatabases();
    console.log(`Found ${dbs.length} user database(s):`);
    dbs.forEach((db, i) => {
      console.log(`  [${i + 1}] ${db.name} (Status: ${db.state})`);
    });
    console.log();
  } catch (err: any) {
    console.warn(`Could not list databases: ${err.message}\n`);
  }

  // 3. Inspect Biometric Table
  console.log(`--- Step 3: Inspecting Target Table [${config.SOURCE_TABLE}] Schema ---`);
  try {
    const schema = await SchemaDiscoveryService.inspectTable(config.SOURCE_TABLE);
    console.log(`✅ Database: [${schema.databaseName}] | Schema: [${schema.schemaName}] | Table: [${schema.tableName}]`);
    console.log(`Total Records: ${schema.totalRecords.toLocaleString()}\n`);

    console.log('Columns:');
    console.table(
      schema.columns.map((c) => ({
        Column: c.columnName,
        Type: c.maxLength ? `${c.dataType}(${c.maxLength})` : c.dataType,
        Nullable: c.isNullable ? 'YES' : 'NO',
        Identity: c.isIdentity ? 'YES (Auto-Inc)' : 'NO',
        Default: c.columnDefault || '-',
      }))
    );

    console.log('\nPrimary Keys:');
    if (schema.primaryKeys.length > 0) {
      console.log(`  ${schema.primaryKeys.join(', ')}`);
    } else {
      console.log('  ⚠️  NO PRIMARY KEY CONSTRAINT found on this table.');
    }

    console.log('\nIndexes:');
    if (schema.indexes.length > 0) {
      console.table(schema.indexes);
    } else {
      console.log('  No explicit indexes found.');
    }

    console.log('\nRecommended Incremental Cursor Strategy:');
    console.log(`  Strategy Type: ${schema.cursorStrategy.type.toUpperCase()}`);
    console.log(`  Cursor Column: [${schema.cursorStrategy.column}]`);
    console.log(`  Rationale:     ${schema.cursorStrategy.rationale}\n`);
  } catch (err: any) {
    console.error(`❌ Table schema inspection failed: ${err.message}\n`);
  }

  // 4. Test HRMS Outbound HTTPS Connectivity
  console.log('--- Step 4: Testing Outbound Connection to CMK HRMS API ---');
  try {
    const hrmsConn = await hrmsApiClient.testConnection();
    if (hrmsConn.ok) {
      console.log(`✅ Outbound connection to CMK HRMS successful! (Status: ${hrmsConn.status})\n`);
    } else {
      console.warn(`⚠️  Could not reach CMK HRMS: ${hrmsConn.message}\n`);
    }
  } catch (err: any) {
    console.error(`❌ HRMS connection test failed: ${err.message}\n`);
  }

  // 5. Test Heartbeat Authentication
  if (config.SYNC_TOKEN) {
    console.log('--- Step 5: Testing Device Authentication & Heartbeat ---');
    try {
      const hb = await hrmsApiClient.sendHeartbeat({
        pendingRecords: 0,
        recordsSynced: 0,
        agentStatus: 'DIAGNOSTIC_TEST',
      });
      console.log('✅ Heartbeat Authenticated Successfully!');
      console.log(`   - Server Time:    ${hb.serverTime}`);
      console.log(`   - Device ID:      ${hb.deviceId}`);
      console.log(`   - Sync Requested: ${hb.syncRequested}\n`);
    } catch (err: any) {
      console.error(`❌ Heartbeat authentication failed: ${err.message}\n`);
    }
  } else {
    console.log('ℹ️  SYNC_TOKEN is not configured in .env. Skipping authenticated heartbeat check.\n');
  }

  console.log('======================================================================');
  console.log('  DIAGNOSTIC CHECK COMPLETE');
  console.log('======================================================================');
  await dbClient.close();
  process.exit(0);
}

runDiagnose().catch((err) => {
  console.error('Fatal diagnostic error:', err);
  process.exit(1);
});
