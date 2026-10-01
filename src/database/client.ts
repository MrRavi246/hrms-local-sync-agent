import mssql from 'mssql';
import { config } from '../config/index';
import { logger } from '../logger/index';
import { sleep, calculateBackoff } from '../utils/sleep';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private pool: mssql.ConnectionPool | null = null;
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
  private getMssqlConfig(overrideDbName?: string): mssql.config {
    const dbConfig: mssql.config = {
      server: config.DB_SERVER,
      database: overrideDbName || config.DB_NAME || 'master',
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      port: config.DB_PORT,
      options: {
        instanceName: config.DB_INSTANCE || undefined,
        encrypt: config.DB_ENCRYPT,
        trustServerCertificate: config.DB_TRUST_SERVER_CERTIFICATE,
        connectTimeout: 15000,
        requestTimeout: 30000,
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
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    if (this.isConnecting) {
      // Wait for in-flight connection attempt
      while (this.isConnecting) {
        await sleep(500);
      }
      if (this.pool && this.pool.connected) {
        return this.pool;
      }
    }

    this.isConnecting = true;
    try {
      const sqlConfig = this.getMssqlConfig(overrideDbName);
      logger.info(
        `Connecting to SQL Server [${sqlConfig.server}\\${sqlConfig.options?.instanceName || 'DEFAULT'}] Database: [${sqlConfig.database}] User: [${sqlConfig.user}]...`
      );

      this.pool = await new mssql.ConnectionPool(sqlConfig).connect();
      this.connectionAttempts = 0;
      logger.info('✅ Successfully connected to SQL Server Express database.');

      this.pool.on('error', (err) => {
        logger.error(`SQL Server Pool Error: ${err.message}`);
        this.pool = null;
      });

      return this.pool;
    } catch (err: any) {
      this.connectionAttempts += 1;
      this.pool = null;
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
   * Gracefully closes database connection pool
   */
  public async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
        logger.info('SQL Server connection pool closed.');
      } catch (err: any) {
        logger.error(`Error closing SQL connection pool: ${err.message}`);
      } finally {
        this.pool = null;
      }
    }
  }
}

export const dbClient = DatabaseClient.getInstance();
