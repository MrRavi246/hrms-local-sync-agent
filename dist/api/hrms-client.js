"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hrmsApiClient = exports.HrmsApiClient = void 0;
const axios_1 = __importDefault(require("axios"));
const os_1 = __importDefault(require("os"));
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
class HrmsApiClient {
    static instance;
    client;
    agentVersion = '1.0.0';
    rateLimitedUntil = 0;
    isRateLimited() {
        return Date.now() < this.rateLimitedUntil;
    }
    getRateLimitRemainingSeconds() {
        return Math.max(0, Math.ceil((this.rateLimitedUntil - Date.now()) / 1000));
    }
    constructor() {
        this.client = axios_1.default.create({
            baseURL: index_1.config.HRMS_API_URL,
            timeout: 30000, // 30 seconds
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CMK-SyncAgent/1.0',
            },
        });
        // Request interceptor to attach authentication token
        this.client.interceptors.request.use((reqConfig) => {
            if (this.isRateLimited()) {
                const remaining = this.getRateLimitRemainingSeconds();
                return Promise.reject(new Error(`Server cooldown active. Waiting ${remaining}s before next request.`));
            }
            if (index_1.config.SYNC_TOKEN) {
                reqConfig.headers['X-Integration-Key'] = index_1.config.SYNC_TOKEN;
            }
            return reqConfig;
        });
    }
    static getInstance() {
        if (!HrmsApiClient.instance) {
            HrmsApiClient.instance = new HrmsApiClient();
        }
        return HrmsApiClient.instance;
    }
    /**
     * Sends heartbeat ping to HRMS server
     */
    async sendHeartbeat(params) {
        const payload = {
            deviceId: index_1.config.DEVICE_ID,
            agentVersion: this.agentVersion,
            hostname: os_1.default.hostname(),
            osInfo: `${os_1.default.type()} ${os_1.default.release()} (${os_1.default.arch()})`,
            pendingRecords: params.pendingRecords,
            recordsSynced: params.recordsSynced,
            agentStatus: params.agentStatus,
        };
        try {
            const response = await this.client.post('/integrations/heartbeat', payload);
            const data = response.data?.data || response.data || {};
            return {
                success: Boolean(response.data?.success ?? true),
                serverTime: data.serverTime || new Date().toISOString(),
                syncRequested: Boolean(data.syncRequested),
                deviceId: data.deviceId || index_1.config.DEVICE_ID,
            };
        }
        catch (err) {
            this.handleApiError('Heartbeat', err);
            throw err;
        }
    }
    /**
     * Dispatches a batch of normalized attendance records to the HRMS API
     */
    async sendBatch(payload) {
        try {
            const response = await this.client.post('/integrations/attendance/sync', payload);
            const resData = response.data;
            const innerData = resData.data || {};
            return {
                success: Boolean(resData.success ?? true),
                requestId: resData.requestId || innerData.requestId || payload.requestId,
                received: typeof resData.received === 'number' ? resData.received : innerData.received ?? payload.records.length,
                inserted: typeof resData.inserted === 'number' ? resData.inserted : innerData.inserted ?? 0,
                duplicates: typeof resData.duplicates === 'number' ? resData.duplicates : innerData.duplicates ?? 0,
                rejected: typeof resData.rejected === 'number' ? resData.rejected : innerData.rejected ?? 0,
                nextSyncCursor: resData.nextSyncCursor || innerData.nextSyncCursor || payload.cursor || undefined,
                message: resData.message || innerData.message,
            };
        }
        catch (err) {
            this.handleApiError('BatchSync', err);
            throw err;
        }
    }
    /**
     * Tests outbound connectivity to HRMS health or root endpoint
     */
    async testConnection() {
        try {
            const res = await this.client.get('/health', { timeout: 10000 });
            return { ok: true, status: res.status, message: res.data?.service || 'Connected' };
        }
        catch (err) {
            if (err.response) {
                return { ok: true, status: err.response.status, message: 'Server reached' };
            }
            return { ok: false, status: 0, message: err.message };
        }
    }
    /**
     * Structured error logging without leaking secrets
     */
    handleApiError(action, error) {
        if (axios_1.default.isAxiosError(error)) {
            const axiosErr = error;
            if (!axiosErr.response) {
                index_2.logger.error(`[HRMS API ${action}] Network/Connection failure: ${axiosErr.message}. Verify Windows PC has outbound internet access to ${index_1.config.HRMS_API_URL}`);
            }
            else if (axiosErr.response.status === 401) {
                index_2.logger.error(`[HRMS API ${action}] 401 Unauthorized: Invalid or missing SYNC_TOKEN. Please generate a new key in HRMS Admin Suite -> Integrations.`);
            }
            else if (axiosErr.response.status === 403 || axiosErr.response.status === 429) {
                // Cooldown for 5 minutes (300 seconds) to allow firewall/WAF ban to expire
                this.rateLimitedUntil = Date.now() + 5 * 60 * 1000;
                index_2.logger.warn(`[HRMS API ${action}] ⚠️ HTTP ${axiosErr.response.status} (Rate Limit / Firewall Block). Pausing cloud requests for 5 minutes to allow IP cooldown...`);
            }
            else {
                const resData = axiosErr.response.data;
                const detailMsg = typeof resData === 'string'
                    ? resData.slice(0, 300)
                    : resData?.message || resData?.error || JSON.stringify(resData);
                index_2.logger.error(`[HRMS API ${action}] Client Error (${axiosErr.response.status}): ${detailMsg || axiosErr.message}`);
            }
        }
        else {
            index_2.logger.error(`[HRMS API ${action}] Unexpected error: ${error.message}`);
        }
    }
}
exports.HrmsApiClient = HrmsApiClient;
exports.hrmsApiClient = HrmsApiClient.getInstance();
