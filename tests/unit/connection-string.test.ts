import { parseAdoConnectionString } from '../../src/config/index';

export async function testConnectionStringParser() {
  console.log('🧪 Testing ADO.NET Connection String Parser...');

  const cs =
    'Data Source=DESKTOP-0424DUH\\SQLEXPRESS;Persist Security Info=True;User ID=sa;Password=abc@123;Pooling=False;MultipleActiveResultSets=False;Encrypt=False;TrustServerCertificate=False;Application Name="SQL Server Management Studio";Command Timeout=0';

  const parsed = parseAdoConnectionString(cs);

  if (parsed.server !== 'DESKTOP-0424DUH') {
    throw new Error(`Expected server DESKTOP-0424DUH, got ${parsed.server}`);
  }
  if (parsed.instance !== 'SQLEXPRESS') {
    throw new Error(`Expected instance SQLEXPRESS, got ${parsed.instance}`);
  }
  if (parsed.user !== 'sa') {
    throw new Error(`Expected user sa, got ${parsed.user}`);
  }
  if (parsed.password !== 'abc@123') {
    throw new Error(`Expected password abc@123, got ${parsed.password}`);
  }
  if (parsed.encrypt !== false) {
    throw new Error(`Expected encrypt false, got ${parsed.encrypt}`);
  }
  if (parsed.trustServerCertificate !== false) {
    throw new Error(`Expected trustServerCertificate false, got ${parsed.trustServerCertificate}`);
  }
  if (parsed.appName !== 'SQL Server Management Studio') {
    throw new Error(`Expected appName SQL Server Management Studio, got ${parsed.appName}`);
  }
  if (parsed.commandTimeout !== 0) {
    throw new Error(`Expected commandTimeout 0, got ${parsed.commandTimeout}`);
  }

  // Test 2: Connection string with port and initial catalog
  const cs2 =
    'Server=192.168.1.50,1433;Database=BiometricVendorDB;User Id=hrms_user;Password=SecurePassword99!;Encrypt=true;TrustServerCertificate=true';
  const parsed2 = parseAdoConnectionString(cs2);

  if (parsed2.server !== '192.168.1.50') {
    throw new Error(`Expected server 192.168.1.50, got ${parsed2.server}`);
  }
  if (parsed2.port !== 1433) {
    throw new Error(`Expected port 1433, got ${parsed2.port}`);
  }
  if (parsed2.database !== 'BiometricVendorDB') {
    throw new Error(`Expected database BiometricVendorDB, got ${parsed2.database}`);
  }
  if (parsed2.user !== 'hrms_user') {
    throw new Error(`Expected user hrms_user, got ${parsed2.user}`);
  }
  if (parsed2.password !== 'SecurePassword99!') {
    throw new Error(`Expected password SecurePassword99!, got ${parsed2.password}`);
  }
  if (parsed2.encrypt !== true) {
    throw new Error(`Expected encrypt true, got ${parsed2.encrypt}`);
  }
  if (parsed2.trustServerCertificate !== true) {
    throw new Error(`Expected trustServerCertificate true, got ${parsed2.trustServerCertificate}`);
  }

  console.log('✅ Connection string parser tests passed successfully!');
}
