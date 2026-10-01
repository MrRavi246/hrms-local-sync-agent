import { z } from 'zod';
export interface ParsedConnectionString {
    server?: string;
    instance?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    appName?: string;
    commandTimeout?: number;
    raw: Record<string, string>;
}
/**
 * Parses standard ADO.NET SQL Server connection strings into structured parameters.
 * Example: "Data Source=DESKTOP-0424DUH\\SQLEXPRESS;User ID=sa;Password=abc@123;..."
 */
export declare function parseAdoConnectionString(cs: string): ParsedConnectionString;
declare const configSchema: z.ZodObject<{
    DB_CONNECTION_STRING: z.ZodOptional<z.ZodString>;
    DB_SERVER: z.ZodDefault<z.ZodString>;
    DB_INSTANCE: z.ZodDefault<z.ZodString>;
    DB_PORT: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<number | undefined, string | undefined>>;
    DB_NAME: z.ZodDefault<z.ZodString>;
    DB_USER: z.ZodDefault<z.ZodString>;
    DB_PASSWORD: z.ZodDefault<z.ZodString>;
    DB_ENCRYPT: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<boolean, string>>;
    DB_TRUST_SERVER_CERTIFICATE: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<boolean, string>>;
    DB_APP_NAME: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    DB_COMMAND_TIMEOUT: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<number | undefined, string | undefined>>;
    SOURCE_TABLE: z.ZodDefault<z.ZodString>;
    HRMS_API_URL: z.ZodPipe<z.ZodDefault<z.ZodString>, z.ZodTransform<string, string>>;
    SYNC_TOKEN: z.ZodDefault<z.ZodString>;
    DEVICE_ID: z.ZodDefault<z.ZodString>;
    DEVICE_NAME: z.ZodDefault<z.ZodString>;
    SYNC_INTERVAL_SECONDS: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<number, string>>;
    SYNC_BATCH_SIZE: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<number, string>>;
    HEARTBEAT_INTERVAL_SECONDS: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<number, string>>;
    SYNC_DRY_RUN: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<boolean, string>>;
    AGENT_PORT: z.ZodPipe<z.ZodDefault<z.ZodOptional<z.ZodString>>, z.ZodTransform<number, string>>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        debug: "debug";
        error: "error";
        info: "info";
        warn: "warn";
    }>>;
    DATA_DIR: z.ZodDefault<z.ZodString>;
    LOGS_DIR: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type AgentConfig = z.infer<typeof configSchema>;
export declare const config: {
    DB_CONNECTION_STRING?: string | undefined;
    DB_SERVER: string;
    DB_INSTANCE: string;
    DB_PORT: number | undefined;
    DB_NAME: string;
    DB_USER: string;
    DB_PASSWORD: string;
    DB_ENCRYPT: boolean;
    DB_TRUST_SERVER_CERTIFICATE: boolean;
    DB_APP_NAME: string;
    DB_COMMAND_TIMEOUT: number | undefined;
    SOURCE_TABLE: string;
    HRMS_API_URL: string;
    SYNC_TOKEN: string;
    DEVICE_ID: string;
    DEVICE_NAME: string;
    SYNC_INTERVAL_SECONDS: number;
    SYNC_BATCH_SIZE: number;
    HEARTBEAT_INTERVAL_SECONDS: number;
    SYNC_DRY_RUN: boolean;
    AGENT_PORT: number;
    LOG_LEVEL: "debug" | "error" | "info" | "warn";
    DATA_DIR: string;
    LOGS_DIR: string;
};
/**
 * Returns a sanitized copy of configuration safe for logging (secrets masked)
 */
export declare function getSanitizedConfig(): Record<string, any>;
export {};
