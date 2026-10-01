import axios, { AxiosInstance, AxiosError } from 'axios';
import os from 'os';
import { config } from '../config/index';
import { logger } from '../logger/index';
import { NormalizedSyncRecord } from '../utils/normalizer';

export interface HeartbeatRequest {
  deviceId: string;
  agentVersion: string;
  hostname: string;
  osInfo: string;
  pendingRecords: number;
  recordsSynced: number;
  agentStatus: string;
}

export interface HeartbeatResponse {
  success: boolean;
  serverTime: string;
  syncRequested: boolean;
  deviceId: string;
}

export interface SyncBatchRequest {
  deviceId: string;
  requestId: string;
  cursor: string | null;
  records: NormalizedSyncRecord[];
}

export interface SyncBatchResponse {
  success: boolean;
  requestId: string;
  received: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  nextSyncCursor?: string;
  message?: string;
}

export class HrmsApiClient {
  private static instance: HrmsApiClient;
  private client: AxiosInstance;
  public readonly agentVersion = '1.0.0';

  private constructor() {
    this.client = axios.create({
      baseURL: config.HRMS_API_URL,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `hrms-local-sync-agent/${this.agentVersion}`,
      },
    });

    // Request interceptor to attach authentication token
    this.client.interceptors.request.use((reqConfig) => {
      if (config.SYNC_TOKEN) {
        reqConfig.headers['X-Integration-Key'] = config.SYNC_TOKEN;
      }
      return reqConfig;
    });
  }

  public static getInstance(): HrmsApiClient {
    if (!HrmsApiClient.instance) {
      HrmsApiClient.instance = new HrmsApiClient();
    }
    return HrmsApiClient.instance;
  }

  /**
   * Sends heartbeat ping to HRMS server
   */
  public async sendHeartbeat(params: {
    pendingRecords: number;
    recordsSynced: number;
    agentStatus: string;
  }): Promise<HeartbeatResponse> {
    const payload: HeartbeatRequest = {
      deviceId: config.DEVICE_ID,
      agentVersion: this.agentVersion,
      hostname: os.hostname(),
      osInfo: `${os.type()} ${os.release()} (${os.arch()})`,
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
        deviceId: data.deviceId || config.DEVICE_ID,
      };
    } catch (err: any) {
      this.handleApiError('Heartbeat', err);
      throw err;
    }
  }

  /**
   * Dispatches a batch of normalized attendance records to the HRMS API
   */
  public async sendBatch(payload: SyncBatchRequest): Promise<SyncBatchResponse> {
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
    } catch (err: any) {
      this.handleApiError('BatchSync', err);
      throw err;
    }
  }

  /**
   * Tests outbound connectivity to HRMS health or root endpoint
   */
  public async testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
    try {
      const res = await this.client.get('/health', { timeout: 10000 });
      return { ok: true, status: res.status, message: res.data?.service || 'Connected' };
    } catch (err: any) {
      if (err.response) {
        return { ok: true, status: err.response.status, message: 'Server reached' };
      }
      return { ok: false, status: 0, message: err.message };
    }
  }

  /**
   * Structured error logging without leaking secrets
   */
  private handleApiError(action: string, error: any): void {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError<any>;
      if (!axiosErr.response) {
        logger.error(
          `[HRMS API ${action}] Network/Connection failure: ${axiosErr.message}. Verify Windows PC has outbound internet access to ${config.HRMS_API_URL}`
        );
      } else if (axiosErr.response.status === 401) {
        logger.error(
          `[HRMS API ${action}] 401 Unauthorized: Invalid or missing SYNC_TOKEN. Please generate a new key in HRMS Admin Suite -> Integrations.`
        );
      } else if (axiosErr.response.status >= 500) {
        logger.error(
          `[HRMS API ${action}] Remote Server Error (${axiosErr.response.status}): ${axiosErr.response.data?.message || axiosErr.message}`
        );
      } else {
        logger.error(
          `[HRMS API ${action}] Client Error (${axiosErr.response.status}): ${axiosErr.response.data?.message || axiosErr.message}`
        );
      }
    } else {
      logger.error(`[HRMS API ${action}] Unexpected error: ${error.message}`);
    }
  }
}

export const hrmsApiClient = HrmsApiClient.getInstance();
