"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../config/index");
const client_1 = require("../database/client");
const hrms_client_1 = require("../api/hrms-client");
async function testConnection() {
    console.log('Testing connectivity for CMK HRMS Local Sync Agent...\n');
    console.log('1. Checking SQL Server Express...');
    const dbPing = await client_1.dbClient.ping();
    if (dbPing.connected) {
        console.log(`✅ SQL Server reachable (${dbPing.latencyMs}ms)`);
    }
    else {
        console.log(`❌ SQL Server unreachable: ${dbPing.error}`);
    }
    console.log('\n2. Checking HRMS API...');
    const hrmsPing = await hrms_client_1.hrmsApiClient.testConnection();
    if (hrmsPing.ok) {
        console.log(`✅ HRMS API reachable at ${index_1.config.HRMS_API_URL} (Status: ${hrmsPing.status})`);
    }
    else {
        console.log(`❌ HRMS API unreachable: ${hrmsPing.message}`);
    }
    await client_1.dbClient.close();
    process.exit(dbPing.connected && hrmsPing.ok ? 0 : 1);
}
testConnection();
