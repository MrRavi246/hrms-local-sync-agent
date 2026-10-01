import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file if present
dotenv.config();

const configSchema = z.object({
  // SQL Server Settings
  DB_SERVER: z.string().default('DESKTOP-0424DUH'),
  DB_INSTANCE: z.string().default('SQLEXPRESS'),
  DB_PORT: z
    .string()
    .optional()
    .transform((val) => (val && val.trim() ? parseInt(val.trim(), 10) : undefined)),
  DB_NAME: z.string().default(''),
  DB_USER: z.string().default('sa'),
  DB_PASSWORD: z.string().default(''),
  DB_ENCRYPT: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),
  DB_TRUST_SERVER_CERTIFICATE: z
    .string()
    .optional()
    .default('true')
    .transform((val) => val !== 'false'),
  SOURCE_TABLE: z.string().default('AttendanceLogs'),

  // HRMS Remote API Settings
  HRMS_API_URL: z
    .string()
    .default('https://cmkhr.com/api/v1')
    .transform((url) => url.replace(/\/+$/, '')), // strip trailing slashes
  SYNC_TOKEN: z.string().default(''),

  // Device Identification
  DEVICE_ID: z.string().default('OFFICE-PC-01'),
  DEVICE_NAME: z.string().default('Main Office Biometric Laptop'),

  // Synchronization Parameters
  SYNC_INTERVAL_SECONDS: z
    .string()
    .optional()
    .default('60')
    .transform((val) => Math.max(10, parseInt(val, 10) || 60)),
  SYNC_BATCH_SIZE: z
    .string()
    .optional()
    .default('500')
    .transform((val) => Math.min(2000, Math.max(10, parseInt(val, 10) || 500))),
  HEARTBEAT_INTERVAL_SECONDS: z
    .string()
    .optional()
    .default('60')
    .transform((val) => Math.max(15, parseInt(val, 10) || 60)),
  SYNC_DRY_RUN: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true' || process.argv.includes('--dry-run')),

  // Local Health Server & Logging
  AGENT_PORT: z
    .string()
    .optional()
    .default('8088')
    .transform((val) => parseInt(val, 10) || 8088),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Data directories
  DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data')),
  LOGS_DIR: z.string().default(path.resolve(process.cwd(), 'logs')),
});

export type AgentConfig = z.infer<typeof configSchema>;

let parsedConfig: AgentConfig;

try {
  parsedConfig = configSchema.parse(process.env);
} catch (error: any) {
  console.error('❌ Configuration Validation Failed:');
  if (error instanceof z.ZodError) {
    error.issues.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error(error.message);
  }
  process.exit(1);
}

export const config = parsedConfig;

/**
 * Returns a sanitized copy of configuration safe for logging (secrets masked)
 */
export function getSanitizedConfig(): Record<string, any> {
  return {
    ...config,
    DB_PASSWORD: config.DB_PASSWORD ? '******** (masked)' : '(not set)',
    SYNC_TOKEN: config.SYNC_TOKEN
      ? `${config.SYNC_TOKEN.slice(0, 10)}...${config.SYNC_TOKEN.slice(-4)}`
      : '(not set)',
  };
}
