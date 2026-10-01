import winston from 'winston';
import 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index';

// Ensure logs directory exists
if (!fs.existsSync(config.LOGS_DIR)) {
  fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

/**
 * Filter to redact sensitive tokens, passwords, and secrets
 */
const sanitizeFormat = winston.format((info) => {
  let message = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);

  if (config.DB_PASSWORD && config.DB_PASSWORD.length > 3) {
    message = message.split(config.DB_PASSWORD).join('********');
  }

  if (config.SYNC_TOKEN && config.SYNC_TOKEN.length > 5) {
    message = message.split(config.SYNC_TOKEN).join('cmk_sync_********');
  }

  // Generic bearer token mask
  message = message.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer ********');
  // Generic password in connection strings
  message = message.replace(/password=[^;]+/gi, 'password=********');

  info.message = message;
  return info;
});

// Custom readable timestamp format
const customTimestamp = winston.format.timestamp({
  format: 'YYYY-MM-DD HH:mm:ss',
});

// Console logging format
const consoleFormat = winston.format.combine(
  sanitizeFormat(),
  customTimestamp,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  })
);

// File logging format
const fileFormat = winston.format.combine(
  sanitizeFormat(),
  customTimestamp,
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

// Daily file transport for all application logs
const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(config.LOGS_DIR, 'agent-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  format: fileFormat,
});

// Daily file transport for errors only
const errorFileTransport = new winston.transports.DailyRotateFile({
  level: 'error',
  filename: path.join(config.LOGS_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '60d',
  format: fileFormat,
});

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    dailyRotateFileTransport,
    errorFileTransport,
  ],
});
