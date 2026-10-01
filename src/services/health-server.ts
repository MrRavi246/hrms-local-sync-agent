import http from 'http';
import { config } from '../config/index';
import { logger } from '../logger/index';
import { stateManager } from '../state/state-manager';
import { dbClient } from '../database/client';
import { hrmsApiClient } from '../api/hrms-client';
import { syncEngine } from '../sync/sync-engine';

export class HealthServer {
  private static instance: HealthServer;
  private server: http.Server | null = null;
  private startTime = Date.now();

  private constructor() {}

  public static getInstance(): HealthServer {
    if (!HealthServer.instance) {
      HealthServer.instance = new HealthServer();
    }
    return HealthServer.instance;
  }

  /**
   * Starts local diagnostic HTTP server
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        res.setHeader('Content-Type', 'application/json');

        // Security check: restrict strictly to loopback interfaces
        const remoteIp = req.socket.remoteAddress || '';
        const isLoopback =
          remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';

        if (!isLoopback) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'Access forbidden: local diagnostic only' }));
          return;
        }

        try {
          if (url.pathname === '/health' || url.pathname === '/') {
            const dbCheck = await dbClient.ping();
            const hrmsCheck = await hrmsApiClient.testConnection();
            const state = stateManager.getState();

            const healthData = {
              status: dbCheck.connected && hrmsCheck.ok ? 'HEALTHY' : 'DEGRADED',
              agent: {
                version: hrmsApiClient.agentVersion,
                deviceId: config.DEVICE_ID,
                deviceName: config.DEVICE_NAME,
                uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
                dryRunMode: config.SYNC_DRY_RUN,
              },
              sqlServer: {
                target: `${config.DB_SERVER}\\${config.DB_INSTANCE}`,
                database: config.DB_NAME || '(auto-discovery)',
                connected: dbCheck.connected,
                latencyMs: dbCheck.latencyMs,
                error: dbCheck.error,
              },
              hrmsApi: {
                url: config.HRMS_API_URL,
                connected: hrmsCheck.ok,
                status: hrmsCheck.status,
              },
              syncState: {
                cursor: state.cursor,
                cursorColumn: state.cursorColumn,
                cursorType: state.cursorType,
                lastSyncAt: state.lastSyncAt,
                totalRecordsSynced: state.totalRecordsSynced,
                pendingRecords: state.pendingRecords,
                lastHeartbeatAt: state.lastHeartbeatAt,
                lastError: state.lastError,
                lastErrorAt: state.lastErrorAt,
                consecutiveFailures: state.consecutiveFailures,
              },
              timestamp: new Date().toISOString(),
            };

            res.writeHead(healthData.status === 'HEALTHY' ? 200 : 503);
            res.end(JSON.stringify(healthData, null, 2));
            return;
          }

          if (url.pathname === '/sync-now' && req.method === 'POST') {
            logger.info('Local HTTP request received to trigger manual sync');
            const result = await syncEngine.runSync('local_health_server_trigger');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, result }));
            return;
          }

          if (url.pathname === '/state') {
            res.writeHead(200);
            res.end(JSON.stringify(stateManager.getState(), null, 2));
            return;
          }

          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Endpoint not found', availableEndpoints: ['/health', '/state', 'POST /sync-now'] }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // Bind strictly to 127.0.0.1 loopback
      this.server.listen(config.AGENT_PORT, '127.0.0.1', () => {
        logger.info(`🏥 Local diagnostic health server listening at http://127.0.0.1:${config.AGENT_PORT}/health`);
        resolve();
      });

      this.server.on('error', (err: any) => {
        logger.warn(`Health server could not bind to port ${config.AGENT_PORT}: ${err.message}`);
        resolve();
      });
    });
  }

  /**
   * Stops local diagnostic server
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const healthServer = HealthServer.getInstance();
