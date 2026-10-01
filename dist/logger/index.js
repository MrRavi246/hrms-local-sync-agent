"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
require("winston-daily-rotate-file");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_1 = require("../config/index");
// Ensure logs directory exists
if (!fs_1.default.existsSync(index_1.config.LOGS_DIR)) {
    fs_1.default.mkdirSync(index_1.config.LOGS_DIR, { recursive: true });
}
/**
 * Filter to redact sensitive tokens, passwords, and secrets
 */
const sanitizeFormat = winston_1.default.format((info) => {
    let message = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    if (index_1.config.DB_PASSWORD && index_1.config.DB_PASSWORD.length > 3) {
        message = message.split(index_1.config.DB_PASSWORD).join('********');
    }
    if (index_1.config.SYNC_TOKEN && index_1.config.SYNC_TOKEN.length > 5) {
        message = message.split(index_1.config.SYNC_TOKEN).join('cmk_sync_********');
    }
    // Generic bearer token mask
    message = message.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer ********');
    // Generic password in connection strings
    message = message.replace(/password=[^;]+/gi, 'password=********');
    info.message = message;
    return info;
});
// Custom readable timestamp format
const customTimestamp = winston_1.default.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
});
// Console logging format
const consoleFormat = winston_1.default.format.combine(sanitizeFormat(), customTimestamp, winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
}));
// File logging format
const fileFormat = winston_1.default.format.combine(sanitizeFormat(), customTimestamp, winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}));
// Daily file transport for all application logs
const dailyRotateFileTransport = new winston_1.default.transports.DailyRotateFile({
    filename: path_1.default.join(index_1.config.LOGS_DIR, 'agent-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    format: fileFormat,
});
// Daily file transport for errors only
const errorFileTransport = new winston_1.default.transports.DailyRotateFile({
    level: 'error',
    filename: path_1.default.join(index_1.config.LOGS_DIR, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '60d',
    format: fileFormat,
});
exports.logger = winston_1.default.createLogger({
    level: index_1.config.LOG_LEVEL,
    transports: [
        new winston_1.default.transports.Console({
            format: consoleFormat,
        }),
        dailyRotateFileTransport,
        errorFileTransport,
    ],
});
