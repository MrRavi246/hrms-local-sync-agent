"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbClient = exports.DatabaseClient = void 0;
const mssql_1 = __importDefault(require("mssql"));
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
const sleep_1 = require("../utils/sleep");
class DatabaseClient {
    static instance;
    pools = new Map();
    isConnecting = false;
    connectionAttempts = 0;
    constructor() { }
    static getInstance() {
        if (!DatabaseClient.instance) {
            DatabaseClient.instance = new DatabaseClient();
        }
        return DatabaseClient.instance;
    }
    /**
     * Generates mssql configuration object
     */
    getMssqlConfig(targetDb, trustCertOverride) {
        const trustCert = trustCertOverride !== undefined
            ? trustCertOverride
            : index_1.config.DB_TRUST_SERVER_CERTIFICATE;
        const serverHost = index_1.config.DB_SERVER.includes('\\')
            ? index_1.config.DB_SERVER.split('\\')[0]
            : index_1.config.DB_SERVER;
        const instanceName = index_1.config.DB_INSTANCE ||
            (index_1.config.DB_SERVER.includes('\\') ? index_1.config.DB_SERVER.split('\\')[1] : undefined);
        const dbConfig = {
            server: serverHost,
            database: targetDb,
            user: index_1.config.DB_USER,
            password: index_1.config.DB_PASSWORD,
            port: index_1.config.DB_PORT,
            options: {
                instanceName: index_1.config.DB_PORT ? undefined : (instanceName || undefined),
                encrypt: index_1.config.DB_ENCRYPT,
                trustServerCertificate: trustCert,
                appName: index_1.config.DB_APP_NAME || 'SQL Server Management Studio',
                connectTimeout: 15000,
                requestTimeout: index_1.config.DB_COMMAND_TIMEOUT !== undefined && index_1.config.DB_COMMAND_TIMEOUT >= 0
                    ? index_1.config.DB_COMMAND_TIMEOUT
                    : 30000,
            },
            pool: {
                max: 5,
                min: 1,
                idleTimeoutMillis: 30000,
            },
        };
        return dbConfig;
    }
    /**
     * Connects to SQL Server with exponential backoff on failure
     */
    async getPool(overrideDbName) {
        const targetDb = overrideDbName || index_1.config.DB_NAME || 'master';
        const existingPool = this.pools.get(targetDb);
        if (existingPool && existingPool.connected) {
            return existingPool;
        }
        if (this.isConnecting) {
            // Wait for in-flight connection attempt
            while (this.isConnecting) {
                await (0, sleep_1.sleep)(500);
            }
            const pool = this.pools.get(targetDb);
            if (pool && pool.connected) {
                return pool;
            }
        }
        this.isConnecting = true;
        try {
            let sqlConfig = this.getMssqlConfig(targetDb);
            index_2.logger.info(`Connecting to SQL Server [${sqlConfig.server}\\${sqlConfig.options?.instanceName || 'DEFAULT'}] Database: [${sqlConfig.database}] User: [${sqlConfig.user}]...`);
            let pool;
            try {
                pool = await new mssql_1.default.ConnectionPool(sqlConfig).connect();
            }
            catch (connErr) {
                // Self-healing: If connection failed due to self-signed certificate on local SQL Server Express
                const errMsg = connErr.message || '';
                if (!sqlConfig.options?.trustServerCertificate &&
                    (errMsg.includes('self signed certificate') ||
                        errMsg.includes('certificate verify failed') ||
                        errMsg.includes('CERT_') ||
                        connErr.code === 'ESELFSIGNEDCERT')) {
                    index_2.logger.warn('⚠️  SQL Server rejected self-signed certificate. Retrying with TrustServerCertificate=true...');
                    sqlConfig = this.getMssqlConfig(targetDb, true);
                    pool = await new mssql_1.default.ConnectionPool(sqlConfig).connect();
                    index_2.logger.info('✅ Successfully connected after enabling TrustServerCertificate.');
                }
                else {
                    throw connErr;
                }
            }
            this.connectionAttempts = 0;
            index_2.logger.info(`✅ Successfully connected to SQL Server Express database [${targetDb}].`);
            pool.on('error', (err) => {
                index_2.logger.error(`SQL Server Pool Error [${targetDb}]: ${err.message}`);
                this.pools.delete(targetDb);
            });
            this.pools.set(targetDb, pool);
            return pool;
        }
        catch (err) {
            this.connectionAttempts += 1;
            this.pools.delete(targetDb);
            const backoffMs = (0, sleep_1.calculateBackoff)(this.connectionAttempts, 5000, 60000);
            index_2.logger.error(`❌ SQL Server connection failed (Attempt #${this.connectionAttempts}): ${err.message}. Retrying in ${Math.round(backoffMs / 1000)}s...`);
            const msg = err.message || '';
            if (msg.includes('Failed to connect') && msg.includes('ms')) {
                index_2.logger.warn('💡 [TROUBLESHOOTING TIP] Connection timed out while locating the SQLEXPRESS instance.\n' +
                    '   1. Ensure "SQL Server Browser" Windows service is RUNNING (Run: net start SQLBrowser)\n' +
                    '   2. Ensure TCP/IP protocol is ENABLED in SQL Server Configuration Manager\n' +
                    '   3. Or run as Administrator: scripts\\fix-sql-connection.bat');
            }
            throw err;
        }
        finally {
            this.isConnecting = false;
        }
    }
    /**
     * Pings the SQL Server connection to verify liveness
     */
    async ping() {
        const start = Date.now();
        try {
            const pool = await this.getPool();
            await pool.request().query('SELECT 1 as ping');
            return { connected: true, latencyMs: Date.now() - start };
        }
        catch (err) {
            return { connected: false, error: err.message };
        }
    }
    /**
     * Gracefully closes all database connection pools
     */
    async close() {
        for (const [db, pool] of this.pools.entries()) {
            try {
                await pool.close();
                index_2.logger.info(`SQL Server connection pool [${db}] closed.`);
            }
            catch (err) {
                index_2.logger.error(`Error closing SQL connection pool [${db}]: ${err.message}`);
            }
        }
        this.pools.clear();
    }
}
exports.DatabaseClient = DatabaseClient;
exports.dbClient = DatabaseClient.getInstance();
