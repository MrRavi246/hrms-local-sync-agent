import mssql from 'mssql';
import { config } from '../config/index';
import { logger } from '../logger/index';
import { sleep, calculateBackoff } from '../utils/sleep';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private pools: Map<string, mssql.ConnectionPool> = new Map();
  private isConnecting = false;
  private connectionAttempts = 0;

  private constructor() {}

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Generates mssql configuration object
   */
  private getMssqlConfig(targetDb: string, trustCertOverride?: boolean): mssql.config {
    const trustCert =
      trustCertOverride !== undefined
        ? trustCertOverride
        : config.DB_TRUST_SERVER_CERTIFICATE;

    const serverHost = config.DB_SERVER.includes('\\')
      ? config.DB_SERVER.split('\\')[0]
      : config.DB_SERVER;

    const instanceName =
      config.DB_INSTANCE ||
      (config.DB_SERVER.includes('\\') ? config.DB_SERVER.split('\\')[1] : undefined);

    const dbConfig: mssql.config = {
      server: serverHost,
      database: targetDb,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      port: config.DB_PORT,
      options: {
        instanceName: instanceName || undefined,
        encrypt: config.DB_ENCRYPT,
        trustServerCertificate: trustCert,
        appName: config.DB_APP_NAME || 'SQL Server Management Studio',
        connectTimeout: 15000,
        requestTimeout:
          config.DB_COMMAND_TIMEOUT !== undefined && config.DB_COMMAND_TIMEOUT >= 0
            ? config.DB_COMMAND_TIMEOUT
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
  public async getPool(overrideDbName?: string): Promise<mssql.ConnectionPool> {
    const targetDb = overrideDbName || config.DB_NAME || 'master';

    const existingPool = this.pools.get(targetDb);
    if (existingPool && existingPool.connected) {
      return existingPool;
    }

    if (this.isConnecting) {
      // Wait for in-flight connection attempt
      while (this.isConnecting) {
        await sleep(500);
      }
      const pool = this.pools.get(targetDb);
      if (pool && pool.connected) {
        return pool;
      }
    }

    this.isConnecting = true;
    try {
      let sqlConfig = this.getMssqlConfig(targetDb);
      logger.info(
        `Connecting to SQL Server [${sqlConfig.server}\\${sqlConfig.options?.instanceName || 'DEFAULT'}] Database: [${sqlConfig.database}] User: [${sqlConfig.user}]...`
      );

      let pool: mssql.ConnectionPool;
      try {
        pool = await new mssql.ConnectionPool(sqlConfig).connect();
      } catch (connErr: any) {
        // Self-healing: If connection failed due to self-signed certificate on local SQL Server Express
        const errMsg = connErr.message || '';
        if (
          !sqlConfig.options?.trustServerCertificate &&
          (errMsg.includes('self signed certificate') ||
            errMsg.includes('certificate verify failed') ||
            errMsg.includes('CERT_') ||
            connErr.code === 'ESELFSIGNEDCERT')
        ) {
          logger.warn(
            '⚠️  SQL Server rejected self-signed certificate. Retrying with TrustServerCertificate=true...'
          );
          sqlConfig = this.getMssqlConfig(targetDb, true);
          pool = await new mssql.ConnectionPool(sqlConfig).connect();
          logger.info('✅ Successfully connected after enabling TrustServerCertificate.');
        } else {
          throw connErr;
        }
      }

      this.connectionAttempts = 0;
      logger.info(`✅ Successfully connected to SQL Server Express database [${targetDb}].`);

      pool.on('error', (err) => {
        logger.error(`SQL Server Pool Error [${targetDb}]: ${err.message}`);
        this.pools.delete(targetDb);
      });

      this.pools.set(targetDb, pool);
      return pool;
    } catch (err: any) {
      this.connectionAttempts += 1;
      this.pools.delete(targetDb);
      const backoffMs = calculateBackoff(this.connectionAttempts, 5000, 60000);
      logger.error(
        `❌ SQL Server connection failed (Attempt #${this.connectionAttempts}): ${err.message}. Retrying in ${Math.round(backoffMs / 1000)}s...`
      );
      throw err;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Pings the SQL Server connection to verify liveness
   */
  public async ping(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const pool = await this.getPool();
      await pool.request().query('SELECT 1 as ping');
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { connected: false, error: err.message };
    }
  }

  /**
   * Gracefully closes all database connection pools
   */
  public async close(): Promise<void> {
    for (const [db, pool] of this.pools.entries()) {
      try {
        await pool.close();
        logger.info(`SQL Server connection pool [${db}] closed.`);
      } catch (err: any) {
        logger.error(`Error closing SQL connection pool [${db}]: ${err.message}`);
      }
    }
    this.pools.clear();
  }
}

export const dbClient = DatabaseClient.getInstance();
