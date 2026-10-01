"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.generateDeterministicRecordId = generateDeterministicRecordId;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Computes a deterministic SHA-256 hash string from input data
 */
function sha256(input) {
    return crypto_1.default.createHash('sha256').update(input.trim()).digest('hex');
}
/**
 * Generates a deterministic, collision-resistant sourceRecordId for an attendance punch
 * when the source database does not have an explicit primary key / identity column.
 */
function generateDeterministicRecordId(fields) {
    const parts = [
        fields.employeeCode.trim().toUpperCase(),
        fields.logDateTime.trim(),
        (fields.direction || 'IN').trim().toUpperCase(),
        (fields.deviceSerialNumber || '').trim().toUpperCase(),
        (fields.deviceId || '').trim().toUpperCase(),
    ];
    const rawKey = parts.join('|');
    const hashDigest = sha256(rawKey).slice(0, 32);
    return `hash_${hashDigest}`;
}
