"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthServer = exports.HealthServer = void 0;
const http_1 = __importDefault(require("http"));
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
const state_manager_1 = require("../state/state-manager");
const client_1 = require("../database/client");
const hrms_client_1 = require("../api/hrms-client");
const sync_engine_1 = require("../sync/sync-engine");
class HealthServer {
    static instance;
    server = null;
    startTime = Date.now();
    constructor() { }
    static getInstance() {
        if (!HealthServer.instance) {
            HealthServer.instance = new HealthServer();
        }
        return HealthServer.instance;
    }
    /**
     * Starts local diagnostic HTTP server
     */
    start() {
        return new Promise((resolve) => {
            this.server = http_1.default.createServer(async (req, res) => {
                const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                res.setHeader('Content-Type', 'application/json');
                // Security check: restrict strictly to loopback interfaces
                const remoteIp = req.socket.remoteAddress || '';
                const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
                if (!isLoopback) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ error: 'Access forbidden: local diagnostic only' }));
                    return;
                }
                try {
                    if (url.pathname === '/health' || url.pathname === '/') {
                        const dbCheck = await client_1.dbClient.ping();
                        const hrmsCheck = await hrms_client_1.hrmsApiClient.testConnection();
                        const state = state_manager_1.stateManager.getState();
                        const healthData = {
                            status: dbCheck.connected && hrmsCheck.ok ? 'HEALTHY' : 'DEGRADED',
                            agent: {
                                version: hrms_client_1.hrmsApiClient.agentVersion,
                                deviceId: index_1.config.DEVICE_ID,
                                deviceName: index_1.config.DEVICE_NAME,
                                uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
                                dryRunMode: index_1.config.SYNC_DRY_RUN,
                            },
                            sqlServer: {
                                target: `${index_1.config.DB_SERVER}\\${index_1.config.DB_INSTANCE}`,
                                database: index_1.config.DB_NAME || '(auto-discovery)',
                                connected: dbCheck.connected,
                                latencyMs: dbCheck.latencyMs,
                                error: dbCheck.error,
                            },
                            hrmsApi: {
                                url: index_1.config.HRMS_API_URL,
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
                        index_2.logger.info('Local HTTP request received to trigger manual sync');
                        const result = await sync_engine_1.syncEngine.runSync('local_health_server_trigger');
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, result }));
                        return;
                    }
                    if (url.pathname === '/state') {
                        res.writeHead(200);
                        res.end(JSON.stringify(state_manager_1.stateManager.getState(), null, 2));
                        return;
                    }
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Endpoint not found', availableEndpoints: ['/health', '/state', 'POST /sync-now'] }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
            });
            // Bind strictly to 127.0.0.1 loopback
            this.server.listen(index_1.config.AGENT_PORT, '127.0.0.1', () => {
                index_2.logger.info(`🏥 Local diagnostic health server listening at http://127.0.0.1:${index_1.config.AGENT_PORT}/health`);
                resolve();
            });
            this.server.on('error', (err) => {
                index_2.logger.warn(`Health server could not bind to port ${index_1.config.AGENT_PORT}: ${err.message}`);
                resolve();
            });
        });
    }
    /**
     * Stops local diagnostic server
     */
    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
exports.HealthServer = HealthServer;
exports.healthServer = HealthServer.getInstance();
