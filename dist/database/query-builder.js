"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryBuilderService = void 0;
const mssql_1 = __importDefault(require("mssql"));
const client_1 = require("./client");
const index_1 = require("../logger/index");
class QueryBuilderService {
    /**
     * Fetches the next incremental batch of attendance records from SQL Server
     */
    static async fetchNextBatch(schema, cursor, batchSize, seenBoundaryIds = []) {
        const pool = await client_1.dbClient.getPool(schema.databaseName);
        const request = pool.request();
        const cursorCol = schema.cursorStrategy.column;
        const strategyType = schema.cursorStrategy.type;
        request.input('batchSize', mssql_1.default.Int, batchSize);
        let query;
        if (!cursor) {
            // First initial run: fetch oldest records first to catch up sequentially
            query = `
        SELECT TOP (@batchSize) *
        FROM [${schema.schemaName}].[${schema.tableName}]
        ORDER BY [${cursorCol}] ASC;
      `;
        }
        else {
            if (strategyType === 'identity' || strategyType === 'primary_key') {
                // Strict inequality for unique monotonic IDs
                request.input('cursor', cursor);
                query = `
          SELECT TOP (@batchSize) *
          FROM [${schema.schemaName}].[${schema.tableName}]
          WHERE [${cursorCol}] > @cursor
          ORDER BY [${cursorCol}] ASC;
        `;
            }
            else {
                // Timestamp strategy: use >= with boundary deduplication
                request.input('cursor', cursor);
                query = `
          SELECT TOP (@batchSize) *
          FROM [${schema.schemaName}].[${schema.tableName}]
          WHERE [${cursorCol}] >= @cursor
          ORDER BY [${cursorCol}] ASC;
        `;
            }
        }
        const result = await request.query(query);
        let rows = result.recordset ? [...result.recordset] : [];
        // Filter out already processed boundary records if using timestamp strategy
        if (cursor && strategyType === 'timestamp' && seenBoundaryIds.length > 0) {
            const seenSet = new Set(seenBoundaryIds);
            rows = rows.filter((row) => {
                const idVal = row[schema.identityColumn || ''] || row.sourceRecordId;
                return !idVal || !seenSet.has(String(idVal));
            });
        }
        if (rows.length === 0) {
            return { rows: [], nextCursor: cursor, boundaryRecordIds: [] };
        }
        // Determine the new nextCursor from the last record in the batch
        const lastRow = rows[rows.length - 1];
        let nextCursor;
        const rawLastCursorVal = lastRow[cursorCol];
        if (rawLastCursorVal instanceof Date) {
            nextCursor = rawLastCursorVal.toISOString();
        }
        else {
            nextCursor = String(rawLastCursorVal);
        }
        // Collect IDs at the current batch end timestamp for boundary tracking
        const boundaryRecordIds = [];
        if (strategyType === 'timestamp') {
            for (const row of rows) {
                const rowTime = row[cursorCol] instanceof Date ? row[cursorCol].toISOString() : String(row[cursorCol]);
                if (rowTime === nextCursor) {
                    const id = row[schema.identityColumn || ''] || row.EmployeeCode;
                    if (id)
                        boundaryRecordIds.push(String(id));
                }
            }
        }
        return { rows, nextCursor, boundaryRecordIds };
    }
    /**
     * Estimates remaining unsynchronized records count
     */
    static async getPendingRecordsCount(schema, cursor) {
        if (!cursor) {
            return schema.totalRecords;
        }
        try {
            const pool = await client_1.dbClient.getPool(schema.databaseName);
            const request = pool.request();
            const cursorCol = schema.cursorStrategy.column;
            const strategyType = schema.cursorStrategy.type;
            request.input('cursor', cursor);
            const op = strategyType === 'identity' || strategyType === 'primary_key' ? '>' : '>';
            const query = `
        SELECT COUNT(*) as PendingCount
        FROM [${schema.schemaName}].[${schema.tableName}]
        WHERE [${cursorCol}] ${op} @cursor;
      `;
            const result = await request.query(query);
            return result.recordset[0]?.PendingCount || 0;
        }
        catch (err) {
            index_1.logger.debug(`Could not calculate pending records count: ${err.message}`);
            return 0;
        }
    }
}
exports.QueryBuilderService = QueryBuilderService;
