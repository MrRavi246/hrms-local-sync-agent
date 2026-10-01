import { TableSchemaDiscovery } from './schema-discovery';
export declare class QueryBuilderService {
    /**
     * Fetches the next incremental batch of attendance records from SQL Server
     */
    static fetchNextBatch(schema: TableSchemaDiscovery, cursor: string | null, batchSize: number, seenBoundaryIds?: string[]): Promise<{
        rows: any[];
        nextCursor: string | null;
        boundaryRecordIds: string[];
    }>;
    /**
     * Estimates remaining unsynchronized records count
     */
    static getPendingRecordsCount(schema: TableSchemaDiscovery, cursor: string | null): Promise<number>;
}
