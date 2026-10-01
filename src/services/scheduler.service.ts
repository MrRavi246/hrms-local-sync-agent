import { config } from '../config/index';
import { logger } from '../logger/index';
import { stateManager } from '../state/state-manager';
import { syncEngine } from '../sync/sync-engine';
import { hrmsApiClient } from '../api/hrms-client';
import { QueryBuilderService } from '../database/query-builder';

export class SchedulerService {
  private static instance: SchedulerService;
  private syncTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  private constructor() {}

  public static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  /**
   * Starts all recurring timers (heartbeat + attendance poll)
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('🚀 Starting HRMS Sync Agent Schedulers...');
    logger.info(`   - Heartbeat interval: every ${config.HEARTBEAT_INTERVAL_SECONDS}s`);
    logger.info(`   - Attendance polling interval: every ${config.SYNC_INTERVAL_SECONDS}s`);
    logger.info(`   - Batch size: ${config.SYNC_BATCH_SIZE} records`);
    logger.info(`   - Dry Run mode: ${config.SYNC_DRY_RUN ? 'YES (Active)' : 'NO'}`);

    // Initial immediate heartbeat probe
    await this.tickHeartbeat();

    // Initial immediate sync run
    await this.tickSync();

    // Schedule periodic heartbeat
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.tickHeartbeat();
      } catch (err: any) {
        logger.debug(`Heartbeat tick error: ${err.message}`);
      }
    }, config.HEARTBEAT_INTERVAL_SECONDS * 1000);

    // Schedule periodic sync
    this.syncTimer = setInterval(async () => {
      try {
        await this.tickSync();
      } catch (err: any) {
        logger.debug(`Sync tick error: ${err.message}`);
      }
    }, config.SYNC_INTERVAL_SECONDS * 1000);
  }

  /**
   * Single heartbeat tick
   */
  public async tickHeartbeat(): Promise<void> {
    const state = stateManager.getState();

    // Estimate pending records
    let pendingCount = state.pendingRecords;
    try {
      const schema = await syncEngine.initialize();
      pendingCount = await QueryBuilderService.getPendingRecordsCount(schema, state.cursor);
    } catch {
      // Use last cached count if DB check fails
    }

    try {
      const res = await hrmsApiClient.sendHeartbeat({
        pendingRecords: pendingCount,
        recordsSynced: state.totalRecordsSynced,
        agentStatus: state.agentStatus,
      });

      stateManager.recordHeartbeatSuccess(pendingCount);

      // If HRMS admin clicked "Sync Now", execute immediate sync
      if (res.syncRequested) {
        logger.info('⚡ Remote sync command received from HRMS Admin! Initiating immediate synchronization...');
        setImmediate(() => {
          syncEngine.runSync('remote_admin_command').catch((e) =>
            logger.error(`Remote admin sync failed: ${e.message}`)
          );
        });
      }
    } catch (err: any) {
      logger.warn(`Heartbeat probe failed: ${err.message}`);
    }
  }

  /**
   * Single attendance poll tick
   */
  public async tickSync(): Promise<void> {
    try {
      await syncEngine.runSync('scheduled_poll');
    } catch (err: any) {
      logger.error(`Scheduled sync tick failed: ${err.message}`);
    }
  }

  /**
   * Stops all active timers
   */
  public stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isRunning = false;
    logger.info('Scheduler timers stopped.');
  }
}

export const schedulerService = SchedulerService.getInstance();
