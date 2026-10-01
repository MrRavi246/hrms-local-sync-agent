import { hrmsApiClient } from '../../src/api/hrms-client';
import { config } from '../../src/config/index';

export async function testApiClient() {
  console.log('🧪 Testing HRMS API Client Contracts & Security...');

  // Test 1: Agent version format
  if (!hrmsApiClient.agentVersion || !/^\d+\.\d+\.\d+/.test(hrmsApiClient.agentVersion)) {
    throw new Error(`Invalid agent version format: ${hrmsApiClient.agentVersion}`);
  }

  // Test 2: Verify configured URL stripping
  if (config.HRMS_API_URL.endsWith('/')) {
    throw new Error('HRMS_API_URL should have trailing slashes stripped');
  }

  // Test 3: Local backend ping test (if backend is running on 5001 or localhost)
  try {
    const conn = await hrmsApiClient.testConnection();
    console.log(`   HRMS API Connectivity check returned: ${conn.ok ? 'OK' : 'Offline'} (${conn.message})`);
  } catch (err: any) {
    console.log(`   HRMS API connection check note: ${err.message}`);
  }

  console.log('✅ API Client tests passed successfully!');
}
