"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./config/index");
const index_2 = require("./logger/index");
const client_1 = require("./database/client");
const sync_engine_1 = require("./sync/sync-engine");
const scheduler_service_1 = require("./services/scheduler.service");
const health_server_1 = require("./services/health-server");
async function bootstrap() {
    console.log('======================================================================');
    console.log('  CMK HRMS: LOCAL BIOMETRIC SQL SERVER DATABASE SYNC AGENT');
    console.log('  Production-Ready Outbound Synchronization Service');
    console.log('======================================================================\n');
    index_2.logger.info('Starting CMK HRMS Local Sync Agent...');
    index_2.logger.info(`Runtime Configuration: ${JSON.stringify((0, index_1.getSanitizedConfig)(), null, 2)}`);
    // 1. Start local diagnostic HTTP server
    try {
        await health_server_1.healthServer.start();
    }
    catch (err) {
        index_2.logger.warn(`Could not start diagnostic health server: ${err.message}`);
    }
    // 2. Discover schema and prepare cursor strategy
    try {
        await sync_engine_1.syncEngine.initialize();
    }
    catch (err) {
        index_2.logger.error(`⚠️  Database initialization warning: ${err.message}. The agent will keep running and retry connecting automatically.`);
    }
    // 3. Start recurring heartbeat and attendance sync scheduler
    await scheduler_service_1.schedulerService.start();
    // 4. Graceful Shutdown Handlers
    const handleShutdown = async (signal) => {
        index_2.logger.info(`Received ${signal}. Initiating graceful shutdown...`);
        scheduler_service_1.schedulerService.stop();
        await health_server_1.healthServer.stop();
        await client_1.dbClient.close();
        index_2.logger.info('CMK HRMS Local Sync Agent stopped cleanly. Goodbye.');
        process.exit(0);
    };
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    // Windows service manager stop hook
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            handleShutdown('service shutdown message');
        }
    });
    process.on('unhandledRejection', (reason) => {
        index_2.logger.error(`Unhandled Promise Rejection: ${reason?.message || reason}`);
    });
    process.on('uncaughtException', (err) => {
        index_2.logger.error(`Uncaught Exception: ${err.message}\n${err.stack}`);
    });
}
bootstrap().catch((err) => {
    index_2.logger.error(`Fatal bootstrap error: ${err.message}`);
    process.exit(1);
});
