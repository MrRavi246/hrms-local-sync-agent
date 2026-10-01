import crypto from 'crypto';
import { config } from '../config/index';
import { logger } from '../logger/index';
import { stateManager } from '../state/state-manager';
import { SchemaDiscoveryService, TableSchemaDiscovery } from '../database/schema-discovery';
import { QueryBuilderService } from '../database/query-builder';
import { normalizeAttendanceRecord, NormalizedSyncRecord } from '../utils/normalizer';
import { hrmsApiClient } from '../api/hrms-client';

export interface SyncRunResult {
  status: 'COMPLETED' | 'NO_NEW_RECORDS' | 'SKIPPED_IN_PROGRESS' | 'DRY_RUN' | 'FAILED';
  recordsRead: number;
  recordsSent: number;
  recordsInserted: number;
  recordsDuplicate: number;
  recordsRejected: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  error?: string;
}

export class SyncEngine {
  private static instance: SyncEngine;
  private isSyncInProgress = false;
  private schema: TableSchemaDiscovery | null = null;

  private constructor() {}

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  /**
   * Initializes schema discovery and sets cursor strategy
   */
  public async initialize(): Promise<TableSchemaDiscovery> {
    if (!this.schema) {
      logger.info('🔍 Initializing database schema inspection and cursor discovery...');
      this.schema = await SchemaDiscoveryService.inspectTable(config.SOURCE_TABLE);

      stateManager.setCursorStrategy(
        this.schema.cursorStrategy.column,
        this.schema.cursorStrategy.type
      );

      logger.info(`✅ Target Biometric Table: [${this.schema.schemaName}].[${this.schema.tableName}]`);
      logger.info(`   - Columns discovered: ${this.schema.columns.length}`);
      logger.info(`   - Total table records: ${this.schema.totalRecords.toLocaleString()}`);
      logger.info(
        `   - Selected Cursor Strategy: ${this.schema.cursorStrategy.type.toUpperCase()} on column [${this.schema.cursorStrategy.column}]`
      );
      logger.info(`   - Rationale: ${this.schema.cursorStrategy.rationale}`);
    }
    return this.schema;
  }

  /**
   * Executes a single incremental synchronization pass
   */
  public async runSync(triggerSource = 'scheduled'): Promise<SyncRunResult> {
    // 1. Prevent overlapping synchronization runs
    if (this.isSyncInProgress) {
      logger.debug(`[SyncEngine] Sync run skipped: another synchronization is already in progress (${triggerSource}).`);
      return {
        status: 'SKIPPED_IN_PROGRESS',
        recordsRead: 0,
        recordsSent: 0,
        recordsInserted: 0,
        recordsDuplicate: 0,
        recordsRejected: 0,
        cursorBefore: stateManager.getState().cursor,
        cursorAfter: stateManager.getState().cursor,
      };
    }

    this.isSyncInProgress = true;
    const currentState = stateManager.getState();
    const cursorBefore = currentState.cursor;

    try {
      // 2. Ensure schema is initialized
      const schema = await this.initialize();

      // 3. Query next batch from SQL Server
      const { rows, nextCursor, boundaryRecordIds } = await QueryBuilderService.fetchNextBatch(
        schema,
        cursorBefore,
        config.SYNC_BATCH_SIZE,
        currentState.seenBoundaryIds
      );

      if (rows.length === 0) {
        logger.debug(`[SyncEngine] No new attendance records found since cursor: ${cursorBefore ?? 'ORIGIN'}`);
        return {
          status: 'NO_NEW_RECORDS',
          recordsRead: 0,
          recordsSent: 0,
          recordsInserted: 0,
          recordsDuplicate: 0,
          recordsRejected: 0,
          cursorBefore,
          cursorAfter: cursorBefore,
        };
      }

      logger.info(`[SyncEngine] Found ${rows.length} new records in SQL Server (Trigger: ${triggerSource})`);

      // 4. Normalize raw records
      const normalizedRecords: NormalizedSyncRecord[] = [];
      const primaryKeyCol = schema.identityColumn || (schema.primaryKeys.length === 1 ? schema.primaryKeys[0] : null);

      for (const row of rows) {
        const item = normalizeAttendanceRecord(row, primaryKeyCol);
        if (item) {
          normalizedRecords.push(item);
        } else {
          logger.warn(`Skipping unparseable row in AttendanceLogs: ${JSON.stringify(row)}`);
        }
      }

      if (normalizedRecords.length === 0) {
        logger.warn('[SyncEngine] None of the fetched rows could be normalized. Check table columns.');
        return {
          status: 'FAILED',
          recordsRead: rows.length,
          recordsSent: 0,
          recordsInserted: 0,
          recordsDuplicate: 0,
          recordsRejected: rows.length,
          cursorBefore,
          cursorAfter: cursorBefore,
          error: 'Rows failed normalization',
        };
      }

      // 5. Handle DRY RUN Mode
      if (config.SYNC_DRY_RUN) {
        console.log('\n======================================================');
        console.log('  DRY RUN MODE ENABLED — NO DATA SENT TO HRMS');
        console.log('======================================================');
        console.log(`Found: ${normalizedRecords.length} records`);
        console.log('\nSample Preview (First 3 Normalized Records):');
        console.log(JSON.stringify(normalizedRecords.slice(0, 3), null, 2));
        console.log('------------------------------------------------------');
        console.log(`Current Cursor: ${cursorBefore ?? 'NONE'}`);
        console.log(`Would advance cursor to: ${nextCursor ?? 'NONE'}`);
        console.log('No records were sent to HRMS. Local state was not changed.\n');

        return {
          status: 'DRY_RUN',
          recordsRead: rows.length,
          recordsSent: 0,
          recordsInserted: 0,
          recordsDuplicate: 0,
          recordsRejected: 0,
          cursorBefore,
          cursorAfter: cursorBefore,
        };
      }

      // 6. Send Batch to HRMS API
      const requestId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      logger.info(`[SyncEngine] Sending batch of ${normalizedRecords.length} records to HRMS API (RequestId: ${requestId})...`);

      const response = await hrmsApiClient.sendBatch({
        deviceId: config.DEVICE_ID,
        requestId,
        cursor: nextCursor,
        records: normalizedRecords,
      });

      if (!response.success) {
        throw new Error(response.message || 'HRMS API returned failure response');
      }

      logger.info(
        `[SyncEngine] ✅ HRMS processed ${response.received} records: ` +
          `${response.inserted} new inserted, ${response.duplicates} duplicates skipped, ${response.rejected} rejected.`
      );

      // 7. CRITICAL: Advance local state ONLY upon confirmed HRMS processing
      const safeNextCursor = response.nextSyncCursor || nextCursor || cursorBefore || '0';

      stateManager.commitBatchSuccess({
        nextCursor: safeNextCursor,
        insertedCount: response.inserted,
        boundaryRecordIds,
      });

      logger.info(`[SyncEngine] 💾 Cursor updated safely: ${safeNextCursor}`);

      // 8. If backlog exists (full batch size returned), trigger next batch immediately
      if (rows.length === config.SYNC_BATCH_SIZE) {
        logger.info('[SyncEngine] Full batch processed. Draining backlog immediately...');
        setImmediate(() => {
          this.runSync('drain_backlog').catch((e) =>
            logger.error(`[SyncEngine] Backlog drain error: ${e.message}`)
          );
        });
      }

      return {
        status: 'COMPLETED',
        recordsRead: rows.length,
        recordsSent: normalizedRecords.length,
        recordsInserted: response.inserted,
        recordsDuplicate: response.duplicates,
        recordsRejected: response.rejected,
        cursorBefore,
        cursorAfter: safeNextCursor,
      };
    } catch (err: any) {
      logger.error(`[SyncEngine] ❌ Synchronization batch failed: ${err.message}`);
      // Record failure without advancing cursor so failed records are retried next time
      stateManager.recordSyncFailure(err.message);

      return {
        status: 'FAILED',
        recordsRead: 0,
        recordsSent: 0,
        recordsInserted: 0,
        recordsDuplicate: 0,
        recordsRejected: 0,
        cursorBefore,
        cursorAfter: cursorBefore,
        error: err.message,
      };
    } finally {
      this.isSyncInProgress = false;
    }
  }

  /**
   * Resets schema cache if table changes
   */
  public resetSchemaCache(): void {
    this.schema = null;
  }
}

export const syncEngine = SyncEngine.getInstance();
