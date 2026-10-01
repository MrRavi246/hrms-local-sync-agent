import mssql from 'mssql';
import { dbClient } from './client';
import { config } from '../config/index';
import { logger } from '../logger/index';

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

export class SchemaDiscoveryService {
  private static cachedDiscovery: TableSchemaDiscovery | null = null;

  /**
   * Discovers all user databases on the connected SQL Server instance
   */
  public static async discoverDatabases(): Promise<Array<{ name: string; createDate: Date; state: string }>> {
    const pool = await dbClient.getPool('master');
    const result = await pool.request().query(`
      SELECT name, create_date, state_desc 
      FROM sys.databases 
      WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
      ORDER BY name;
    `);

    return result.recordset.map((r: any) => ({
      name: r.name,
      createDate: r.create_date,
      state: r.state_desc,
    }));
  }

  /**
   * Searches all databases for the AttendanceLogs table
   */
  public static async findBiometricDatabase(): Promise<string | null> {
    const databases = await this.discoverDatabases();
    const pool = await dbClient.getPool('master');

    for (const db of databases) {
      try {
        const query = `
          SELECT TABLE_NAME 
          FROM [${db.name}].INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = 'AttendanceLogs' OR TABLE_NAME LIKE '%AttendanceLog%';
        `;
        const result = await pool.request().query(query);
        if (result.recordset.length > 0) {
          logger.info(`Found biometric table [AttendanceLogs] in database: [${db.name}]`);
          return db.name;
        }
      } catch {
        // Skip inaccessible databases
      }
    }

    return null;
  }

  /**
   * Deeply inspects the target attendance table schema, keys, columns, and indexes
   */
  public static async inspectTable(targetTable = config.SOURCE_TABLE): Promise<TableSchemaDiscovery> {
    if (this.cachedDiscovery && this.cachedDiscovery.tableName.toLowerCase() === targetTable.toLowerCase()) {
      return this.cachedDiscovery;
    }

    let activeDb = config.DB_NAME;
    if (!activeDb) {
      const foundDb = await this.findBiometricDatabase();
      if (!foundDb) {
        throw new Error(
          'Target biometric database could not be automatically located. Please set DB_NAME in your .env file.'
        );
      }
      activeDb = foundDb;
    }

    const pool = await dbClient.getPool(activeDb);

    // 1. Locate Table & Schema
    const tableResult = await pool.request().input('tableName', mssql.NVarChar, targetTable).query(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = @tableName OR TABLE_NAME LIKE '%' + @tableName + '%';
    `);

    if (tableResult.recordset.length === 0) {
      throw new Error(`Table [${targetTable}] was not found in database [${activeDb}].`);
    }

    const actualTable = tableResult.recordset[0].TABLE_NAME;
    const actualSchema = tableResult.recordset[0].TABLE_SCHEMA;

    // 2. Discover Columns & Identities
    const colResult = await pool
      .request()
      .input('tbl', mssql.NVarChar, actualTable)
      .input('sch', mssql.NVarChar, actualSchema).query(`
        SELECT 
          c.COLUMN_NAME, 
          c.DATA_TYPE, 
          c.CHARACTER_MAXIMUM_LENGTH, 
          c.IS_NULLABLE, 
          c.COLUMN_DEFAULT,
          COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as IS_IDENTITY
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_NAME = @tbl AND c.TABLE_SCHEMA = @sch
        ORDER BY c.ORDINAL_POSITION;
      `);

    const columns: ColumnInfo[] = colResult.recordset.map((r: any) => ({
      columnName: r.COLUMN_NAME,
      dataType: r.DATA_TYPE,
      maxLength: r.CHARACTER_MAXIMUM_LENGTH,
      isNullable: r.IS_NULLABLE === 'YES',
      isIdentity: r.IS_IDENTITY === 1,
      columnDefault: r.COLUMN_DEFAULT,
    }));

    // 3. Discover Primary Key Constraints
    const pkResult = await pool
      .request()
      .input('tbl', mssql.NVarChar, actualTable)
      .input('sch', mssql.NVarChar, actualSchema).query(`
        SELECT 
          tc.CONSTRAINT_TYPE, 
          tc.CONSTRAINT_NAME, 
          kcu.COLUMN_NAME,
          kcu.ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME 
          AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        WHERE tc.TABLE_NAME = @tbl AND tc.TABLE_SCHEMA = @sch
          AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ORDER BY kcu.ORDINAL_POSITION;
      `);

    const primaryKeys = pkResult.recordset.map((r: any) => r.COLUMN_NAME);

    // 4. Discover Indexes
    const idxResult = await pool
      .request()
      .input('fullTable', mssql.NVarChar, `${actualSchema}.${actualTable}`).query(`
        SELECT 
          i.name as IndexName,
          i.is_unique as IsUnique,
          i.is_primary_key as IsPrimaryKey,
          c.name as ColumnName
        FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID(@fullTable)
        ORDER BY i.name, ic.key_ordinal;
      `);

    const indexes: IndexInfo[] = idxResult.recordset.map((r: any) => ({
      indexName: r.IndexName,
      isUnique: Boolean(r.IsUnique),
      isPrimaryKey: Boolean(r.IsPrimaryKey),
      columnName: r.ColumnName,
    }));

    // 5. Total Record Count
    const countResult = await pool
      .request()
      .query(`SELECT COUNT(*) as TotalRecords FROM [${actualSchema}].[${actualTable}];`);
    const totalRecords = countResult.recordset[0]?.TotalRecords || 0;

    // 6. Formulate Optimal Cursor Strategy
    const identityCol = columns.find((c) => c.isIdentity);
    let cursorStrategy: TableSchemaDiscovery['cursorStrategy'];

    if (identityCol) {
      cursorStrategy = {
        type: 'identity',
        column: identityCol.columnName,
        rationale: `Optimal monotonic identity column [${identityCol.columnName}] auto-increments with each punch.`,
      };
    } else if (primaryKeys.length === 1) {
      cursorStrategy = {
        type: 'primary_key',
        column: primaryKeys[0],
        rationale: `Single primary key column [${primaryKeys[0]}] guarantees strict monotonicity.`,
      };
    } else {
      // Look for timestamp columns
      const timeCol =
        columns.find((c) => c.columnName.toLowerCase() === 'logdatetime') ||
        columns.find((c) => c.columnName.toLowerCase().includes('datetime')) ||
        columns.find((c) => c.columnName.toLowerCase() === 'logdate');

      if (timeCol) {
        cursorStrategy = {
          type: 'timestamp',
          column: timeCol.columnName,
          rationale: `Timestamp column [${timeCol.columnName}] with deterministic SHA-256 deduplication for identical punch timestamps.`,
        };
      } else {
        cursorStrategy = {
          type: 'custom',
          column: columns[0]?.columnName || 'EmployeeCode',
          rationale: 'Fallback ordering on first available column with deterministic hash deduplication.',
        };
      }
    }

    const discovery: TableSchemaDiscovery = {
      databaseName: activeDb,
      schemaName: actualSchema,
      tableName: actualTable,
      columns,
      primaryKeys,
      identityColumn: identityCol?.columnName || null,
      indexes,
      totalRecords,
      cursorStrategy,
    };

    this.cachedDiscovery = discovery;
    return discovery;
  }
}
