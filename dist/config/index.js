"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.parseAdoConnectionString = parseAdoConnectionString;
exports.getSanitizedConfig = getSanitizedConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
// Load environment variables from .env file if present
dotenv_1.default.config();
/**
 * Parses standard ADO.NET SQL Server connection strings into structured parameters.
 * Example: "Data Source=DESKTOP-0424DUH\\SQLEXPRESS;User ID=sa;Password=abc@123;..."
 */
function parseAdoConnectionString(cs) {
    const result = {};
    const regex = /(?:^|;)\s*([^=;]+?)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^;]*))/g;
    let match;
    while ((match = regex.exec(cs)) !== null) {
        const key = match[1]?.trim();
        const val = (match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] || '').trim();
        if (key) {
            result[key.toLowerCase()] = val;
        }
    }
    const dataSource = result['data source'] ||
        result['server'] ||
        result['addr'] ||
        result['address'] ||
        result['network address'];
    let server;
    let instance;
    let port;
    if (dataSource) {
        const portSplit = dataSource.split(',');
        if (portSplit.length === 2 && portSplit[1].trim()) {
            port = parseInt(portSplit[1].trim(), 10);
        }
        const hostPart = portSplit[0].trim();
        if (hostPart.includes('\\')) {
            const parts = hostPart.split('\\');
            server = parts[0];
            instance = parts[1];
        }
        else {
            server = hostPart;
        }
    }
    const database = result['initial catalog'] || result['database'];
    const user = result['user id'] || result['uid'] || result['user'];
    const password = result['password'] || result['pwd'];
    let encrypt;
    if (result['encrypt'] !== undefined) {
        const val = result['encrypt'].toLowerCase();
        encrypt = val === 'true' || val === 'yes' || val === '1';
    }
    let trustServerCertificate;
    const tscKey = result['trustservercertificate'] ||
        result['trust server certificate'] ||
        result['trustservercert'];
    if (tscKey !== undefined) {
        const val = tscKey.toLowerCase();
        trustServerCertificate = val === 'true' || val === 'yes' || val === '1';
    }
    const appName = result['application name'] || result['app'];
    let commandTimeout;
    if (result['command timeout'] !== undefined) {
        commandTimeout = parseInt(result['command timeout'], 10);
    }
    return {
        server,
        instance,
        port,
        database,
        user,
        password,
        encrypt,
        trustServerCertificate,
        appName,
        commandTimeout,
        raw: result,
    };
}
// If DB_CONNECTION_STRING is present in env, merge into process.env if individual vars are not set
if (process.env.DB_CONNECTION_STRING && process.env.DB_CONNECTION_STRING.trim()) {
    const parsed = parseAdoConnectionString(process.env.DB_CONNECTION_STRING);
    if (parsed.server && !process.env.DB_SERVER) {
        process.env.DB_SERVER = parsed.server;
    }
    if (parsed.instance && !process.env.DB_INSTANCE) {
        process.env.DB_INSTANCE = parsed.instance;
    }
    if (parsed.port !== undefined && !process.env.DB_PORT) {
        process.env.DB_PORT = String(parsed.port);
    }
    if (parsed.database && !process.env.DB_NAME) {
        process.env.DB_NAME = parsed.database;
    }
    if (parsed.user && !process.env.DB_USER) {
        process.env.DB_USER = parsed.user;
    }
    if (parsed.password && !process.env.DB_PASSWORD) {
        process.env.DB_PASSWORD = parsed.password;
    }
    if (parsed.encrypt !== undefined && process.env.DB_ENCRYPT === undefined) {
        process.env.DB_ENCRYPT = String(parsed.encrypt);
    }
    if (parsed.trustServerCertificate !== undefined && process.env.DB_TRUST_SERVER_CERTIFICATE === undefined) {
        process.env.DB_TRUST_SERVER_CERTIFICATE = String(parsed.trustServerCertificate);
    }
    if (parsed.appName && !process.env.DB_APP_NAME) {
        process.env.DB_APP_NAME = parsed.appName;
    }
    if (parsed.commandTimeout !== undefined && !process.env.DB_COMMAND_TIMEOUT) {
        process.env.DB_COMMAND_TIMEOUT = String(parsed.commandTimeout);
    }
}
// Normalize DB_SERVER if it includes named instance backslash: DESKTOP-0424DUH\SQLEXPRESS
if (process.env.DB_SERVER && process.env.DB_SERVER.includes('\\')) {
    const [srv, inst] = process.env.DB_SERVER.split('\\');
    process.env.DB_SERVER = srv;
    if (!process.env.DB_INSTANCE) {
        process.env.DB_INSTANCE = inst;
    }
}
const configSchema = zod_1.z.object({
    // SQL Server Settings
    DB_CONNECTION_STRING: zod_1.z.string().optional(),
    DB_SERVER: zod_1.z.string().default('DESKTOP-0424DUH'),
    DB_INSTANCE: zod_1.z.string().default('SQLEXPRESS'),
    DB_PORT: zod_1.z
        .string()
        .optional()
        .transform((val) => (val && val.trim() ? parseInt(val.trim(), 10) : undefined)),
    DB_NAME: zod_1.z.string().default(''),
    DB_USER: zod_1.z.string().default('sa'),
    DB_PASSWORD: zod_1.z.string().default(''),
    DB_ENCRYPT: zod_1.z
        .string()
        .optional()
        .default('false')
        .transform((val) => val === 'true'),
    DB_TRUST_SERVER_CERTIFICATE: zod_1.z
        .string()
        .optional()
        .default('true')
        .transform((val) => val !== 'false'),
    DB_APP_NAME: zod_1.z.string().optional().default('SQL Server Management Studio'),
    DB_COMMAND_TIMEOUT: zod_1.z
        .string()
        .optional()
        .transform((val) => (val && val.trim() ? parseInt(val.trim(), 10) : undefined)),
    SOURCE_TABLE: zod_1.z.string().default('AttendanceLogs'),
    // HRMS Remote API Settings
    HRMS_API_URL: zod_1.z
        .string()
        .default('https://cmkhr.com/api/v1')
        .transform((url) => url.replace(/\/+$/, '')), // strip trailing slashes
    SYNC_TOKEN: zod_1.z.string().default(''),
    // Device Identification
    DEVICE_ID: zod_1.z.string().default('OFFICE-PC-01'),
    DEVICE_NAME: zod_1.z.string().default('Main Office Biometric Laptop'),
    // Synchronization Parameters
    SYNC_INTERVAL_SECONDS: zod_1.z
        .string()
        .optional()
        .default('60')
        .transform((val) => Math.max(10, parseInt(val, 10) || 60)),
    SYNC_BATCH_SIZE: zod_1.z
        .string()
        .optional()
        .default('500')
        .transform((val) => Math.min(2000, Math.max(10, parseInt(val, 10) || 500))),
    HEARTBEAT_INTERVAL_SECONDS: zod_1.z
        .string()
        .optional()
        .default('60')
        .transform((val) => Math.max(15, parseInt(val, 10) || 60)),
    SYNC_DRY_RUN: zod_1.z
        .string()
        .optional()
        .default('false')
        .transform((val) => val === 'true' || process.argv.includes('--dry-run')),
    // Local Health Server & Logging
    AGENT_PORT: zod_1.z
        .string()
        .optional()
        .default('8088')
        .transform((val) => parseInt(val, 10) || 8088),
    LOG_LEVEL: zod_1.z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // Data directories
    DATA_DIR: zod_1.z.string().default(path_1.default.resolve(process.cwd(), 'data')),
    LOGS_DIR: zod_1.z.string().default(path_1.default.resolve(process.cwd(), 'logs')),
});
let parsedConfig;
try {
    parsedConfig = configSchema.parse(process.env);
}
catch (error) {
    console.error('❌ Configuration Validation Failed:');
    if (error instanceof zod_1.z.ZodError) {
        error.issues.forEach((err) => {
            console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
    }
    else {
        console.error(error.message);
    }
    process.exit(1);
}
exports.config = parsedConfig;
/**
 * Returns a sanitized copy of configuration safe for logging (secrets masked)
 */
function getSanitizedConfig() {
    return {
        ...exports.config,
        DB_PASSWORD: exports.config.DB_PASSWORD ? '******** (masked)' : '(not set)',
        DB_CONNECTION_STRING: exports.config.DB_CONNECTION_STRING
            ? exports.config.DB_CONNECTION_STRING.replace(/password=[^;]+/gi, 'Password=********')
            : '(not set)',
        SYNC_TOKEN: exports.config.SYNC_TOKEN
            ? `${exports.config.SYNC_TOKEN.slice(0, 10)}...${exports.config.SYNC_TOKEN.slice(-4)}`
            : '(not set)',
    };
}
