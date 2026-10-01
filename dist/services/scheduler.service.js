"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerService = exports.SchedulerService = void 0;
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
const state_manager_1 = require("../state/state-manager");
const sync_engine_1 = require("../sync/sync-engine");
const hrms_client_1 = require("../api/hrms-client");
const query_builder_1 = require("../database/query-builder");
class SchedulerService {
    static instance;
    syncTimer = null;
    heartbeatTimer = null;
    isRunning = false;
    constructor() { }
    static getInstance() {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService();
        }
        return SchedulerService.instance;
    }
    /**
     * Starts all recurring timers (heartbeat + attendance poll)
     */
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        index_2.logger.info('🚀 Starting HRMS Sync Agent Schedulers...');
        index_2.logger.info(`   - Heartbeat interval: every ${index_1.config.HEARTBEAT_INTERVAL_SECONDS}s`);
        index_2.logger.info(`   - Attendance polling interval: every ${index_1.config.SYNC_INTERVAL_SECONDS}s`);
        index_2.logger.info(`   - Batch size: ${index_1.config.SYNC_BATCH_SIZE} records`);
        index_2.logger.info(`   - Dry Run mode: ${index_1.config.SYNC_DRY_RUN ? 'YES (Active)' : 'NO'}`);
        // Initial immediate heartbeat probe
        await this.tickHeartbeat();
        // Initial immediate sync run
        await this.tickSync();
        // Schedule periodic heartbeat
        this.heartbeatTimer = setInterval(async () => {
            try {
                await this.tickHeartbeat();
            }
            catch (err) {
                index_2.logger.debug(`Heartbeat tick error: ${err.message}`);
            }
        }, index_1.config.HEARTBEAT_INTERVAL_SECONDS * 1000);
        // Schedule periodic sync
        this.syncTimer = setInterval(async () => {
            try {
                await this.tickSync();
            }
            catch (err) {
                index_2.logger.debug(`Sync tick error: ${err.message}`);
            }
        }, index_1.config.SYNC_INTERVAL_SECONDS * 1000);
    }
    /**
     * Single heartbeat tick
     */
    async tickHeartbeat() {
        const state = state_manager_1.stateManager.getState();
        // Estimate pending records
        let pendingCount = state.pendingRecords;
        try {
            const schema = await sync_engine_1.syncEngine.initialize();
            pendingCount = await query_builder_1.QueryBuilderService.getPendingRecordsCount(schema, state.cursor);
        }
        catch {
            // Use last cached count if DB check fails
        }
        try {
            const res = await hrms_client_1.hrmsApiClient.sendHeartbeat({
                pendingRecords: pendingCount,
                recordsSynced: state.totalRecordsSynced,
                agentStatus: state.agentStatus,
            });
            state_manager_1.stateManager.recordHeartbeatSuccess(pendingCount);
            // If HRMS admin clicked "Sync Now", execute immediate sync
            if (res.syncRequested) {
                index_2.logger.info('⚡ Remote sync command received from HRMS Admin! Initiating immediate synchronization...');
                setImmediate(() => {
                    sync_engine_1.syncEngine.runSync('remote_admin_command').catch((e) => index_2.logger.error(`Remote admin sync failed: ${e.message}`));
                });
            }
        }
        catch (err) {
            index_2.logger.warn(`Heartbeat probe failed: ${err.message}`);
        }
    }
    /**
     * Single attendance poll tick
     */
    async tickSync() {
        try {
            await sync_engine_1.syncEngine.runSync('scheduled_poll');
        }
        catch (err) {
            index_2.logger.error(`Scheduled sync tick failed: ${err.message}`);
        }
    }
    /**
     * Stops all active timers
     */
    stop() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.isRunning = false;
        index_2.logger.info('Scheduler timers stopped.');
    }
}
exports.SchedulerService = SchedulerService;
exports.schedulerService = SchedulerService.getInstance();
