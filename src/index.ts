import { config, getSanitizedConfig } from './config/index';
import { logger } from './logger/index';
import { dbClient } from './database/client';
import { syncEngine } from './sync/sync-engine';
import { schedulerService } from './services/scheduler.service';
import { healthServer } from './services/health-server';

async function bootstrap() {
  console.log('======================================================================');
  console.log('  CMK HRMS: LOCAL BIOMETRIC SQL SERVER DATABASE SYNC AGENT');
  console.log('  Production-Ready Outbound Synchronization Service');
  console.log('======================================================================\n');

  logger.info('Starting CMK HRMS Local Sync Agent...');
  logger.info(`Runtime Configuration: ${JSON.stringify(getSanitizedConfig(), null, 2)}`);

  // 1. Start local diagnostic HTTP server
  try {
    await healthServer.start();
  } catch (err: any) {
    logger.warn(`Could not start diagnostic health server: ${err.message}`);
  }

  // 2. Discover schema and prepare cursor strategy
  try {
    await syncEngine.initialize();
  } catch (err: any) {
    logger.error(
      `⚠️  Database initialization warning: ${err.message}. The agent will keep running and retry connecting automatically.`
    );
  }

  // 3. Start recurring heartbeat and attendance sync scheduler
  await schedulerService.start();

  // 4. Graceful Shutdown Handlers
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    schedulerService.stop();
    await healthServer.stop();
    await dbClient.close();
    logger.info('CMK HRMS Local Sync Agent stopped cleanly. Goodbye.');
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

  process.on('unhandledRejection', (reason: any) => {
    logger.error(`Unhandled Promise Rejection: ${reason?.message || reason}`);
  });

  process.on('uncaughtException', (err: Error) => {
    logger.error(`Uncaught Exception: ${err.message}\n${err.stack}`);
  });
}

bootstrap().catch((err) => {
  logger.error(`Fatal bootstrap error: ${err.message}`);
  process.exit(1);
});
