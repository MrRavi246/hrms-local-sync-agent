"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEngine = exports.SyncEngine = void 0;
const crypto_1 = __importDefault(require("crypto"));
const index_1 = require("../config/index");
const index_2 = require("../logger/index");
const state_manager_1 = require("../state/state-manager");
const schema_discovery_1 = require("../database/schema-discovery");
const query_builder_1 = require("../database/query-builder");
const normalizer_1 = require("../utils/normalizer");
const hrms_client_1 = require("../api/hrms-client");
class SyncEngine {
    static instance;
    isSyncInProgress = false;
    schema = null;
    constructor() { }
    static getInstance() {
        if (!SyncEngine.instance) {
            SyncEngine.instance = new SyncEngine();
        }
        return SyncEngine.instance;
    }
    /**
     * Initializes schema discovery and sets cursor strategy
     */
    async initialize() {
        if (!this.schema) {
            index_2.logger.info('🔍 Initializing database schema inspection and cursor discovery...');
            this.schema = await schema_discovery_1.SchemaDiscoveryService.inspectTable(index_1.config.SOURCE_TABLE);
            state_manager_1.stateManager.setCursorStrategy(this.schema.cursorStrategy.column, this.schema.cursorStrategy.type);
            index_2.logger.info(`✅ Target Biometric Table: [${this.schema.schemaName}].[${this.schema.tableName}]`);
            index_2.logger.info(`   - Columns discovered: ${this.schema.columns.length}`);
            index_2.logger.info(`   - Total table records: ${this.schema.totalRecords.toLocaleString()}`);
            index_2.logger.info(`   - Selected Cursor Strategy: ${this.schema.cursorStrategy.type.toUpperCase()} on column [${this.schema.cursorStrategy.column}]`);
            index_2.logger.info(`   - Rationale: ${this.schema.cursorStrategy.rationale}`);
        }
        return this.schema;
    }
    /**
     * Executes a single incremental synchronization pass
     */
    async runSync(triggerSource = 'scheduled') {
        // 1. Prevent overlapping synchronization runs
        if (this.isSyncInProgress) {
            index_2.logger.debug(`[SyncEngine] Sync run skipped: another synchronization is already in progress (${triggerSource}).`);
            return {
                status: 'SKIPPED_IN_PROGRESS',
                recordsRead: 0,
                recordsSent: 0,
                recordsInserted: 0,
                recordsDuplicate: 0,
                recordsRejected: 0,
                cursorBefore: state_manager_1.stateManager.getState().cursor,
                cursorAfter: state_manager_1.stateManager.getState().cursor,
            };
        }
        this.isSyncInProgress = true;
        const currentState = state_manager_1.stateManager.getState();
        const cursorBefore = currentState.cursor;
        try {
            // 2. Ensure schema is initialized
            const schema = await this.initialize();
            // 3. Query next batch from SQL Server
            const { rows, nextCursor, boundaryRecordIds } = await query_builder_1.QueryBuilderService.fetchNextBatch(schema, cursorBefore, index_1.config.SYNC_BATCH_SIZE, currentState.seenBoundaryIds);
            if (rows.length === 0) {
                index_2.logger.debug(`[SyncEngine] No new attendance records found since cursor: ${cursorBefore ?? 'ORIGIN'}`);
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
            index_2.logger.info(`[SyncEngine] Found ${rows.length} new records in SQL Server (Trigger: ${triggerSource})`);
            // 4. Normalize raw records
            const normalizedRecords = [];
            const primaryKeyCol = schema.identityColumn || (schema.primaryKeys.length === 1 ? schema.primaryKeys[0] : null);
            for (const row of rows) {
                const item = (0, normalizer_1.normalizeAttendanceRecord)(row, primaryKeyCol);
                if (item) {
                    normalizedRecords.push(item);
                }
                else {
                    index_2.logger.warn(`Skipping unparseable row in AttendanceLogs: ${JSON.stringify(row)}`);
                }
            }
            if (normalizedRecords.length === 0) {
                index_2.logger.warn('[SyncEngine] None of the fetched rows could be normalized. Check table columns.');
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
            if (index_1.config.SYNC_DRY_RUN) {
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
            const requestId = `req_${Date.now()}_${crypto_1.default.randomBytes(4).toString('hex')}`;
            index_2.logger.info(`[SyncEngine] Sending batch of ${normalizedRecords.length} records to HRMS API (RequestId: ${requestId})...`);
            const response = await hrms_client_1.hrmsApiClient.sendBatch({
                deviceId: index_1.config.DEVICE_ID,
                requestId,
                cursor: nextCursor,
                records: normalizedRecords,
            });
            if (!response.success) {
                throw new Error(response.message || 'HRMS API returned failure response');
            }
            index_2.logger.info(`[SyncEngine] ✅ HRMS processed ${response.received} records: ` +
                `${response.inserted} new inserted, ${response.duplicates} duplicates skipped, ${response.rejected} rejected.`);
            // 7. CRITICAL: Advance local state ONLY upon confirmed HRMS processing
            const safeNextCursor = response.nextSyncCursor || nextCursor || cursorBefore || '0';
            state_manager_1.stateManager.commitBatchSuccess({
                nextCursor: safeNextCursor,
                insertedCount: response.inserted,
                boundaryRecordIds,
            });
            index_2.logger.info(`[SyncEngine] 💾 Cursor updated safely: ${safeNextCursor}`);
            // 8. If backlog exists (full batch size returned), trigger next batch immediately
            if (rows.length === index_1.config.SYNC_BATCH_SIZE) {
                index_2.logger.info('[SyncEngine] Full batch processed. Draining backlog immediately...');
                setImmediate(() => {
                    this.runSync('drain_backlog').catch((e) => index_2.logger.error(`[SyncEngine] Backlog drain error: ${e.message}`));
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
        }
        catch (err) {
            index_2.logger.error(`[SyncEngine] ❌ Synchronization batch failed: ${err.message}`);
            // Record failure without advancing cursor so failed records are retried next time
            state_manager_1.stateManager.recordSyncFailure(err.message);
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
        }
        finally {
            this.isSyncInProgress = false;
        }
    }
    /**
     * Resets schema cache if table changes
     */
    resetSchemaCache() {
        this.schema = null;
    }
}
exports.SyncEngine = SyncEngine;
exports.syncEngine = SyncEngine.getInstance();
