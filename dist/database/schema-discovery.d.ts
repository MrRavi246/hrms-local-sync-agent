export interface ColumnInfo {
    columnName: string;
    dataType: string;
    maxLength: number | null;
    isNullable: boolean;
    isIdentity: boolean;
    columnDefault: string | null;
}
export interface ConstraintInfo {
    constraintType: string;
    constraintName: string;
    columnName: string;
    ordinalPosition: number;
}
export interface IndexInfo {
    indexName: string;
    isUnique: boolean;
    isPrimaryKey: boolean;
    columnName: string;
}
export interface TableSchemaDiscovery {
    databaseName: string;
    schemaName: string;
    tableName: string;
    columns: ColumnInfo[];
    primaryKeys: string[];
    identityColumn: string | null;
    indexes: IndexInfo[];
    totalRecords: number;
    cursorStrategy: {
        type: 'identity' | 'primary_key' | 'timestamp' | 'custom';
        column: string;
        rationale: string;
    };
}
export declare class SchemaDiscoveryService {
    private static cachedDiscovery;
    /**
     * Discovers all user databases on the connected SQL Server instance
     */
    static discoverDatabases(): Promise<Array<{
        name: string;
        createDate: Date;
        state: string;
    }>>;
    /**
     * Searches all databases for the AttendanceLogs table
     */
    static findBiometricDatabase(): Promise<string | null>;
    /**
     * Deeply inspects the target attendance table schema, keys, columns, and indexes
     */
    static inspectTable(targetTable?: string): Promise<TableSchemaDiscovery>;
}
