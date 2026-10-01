"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
exports.calculateBackoff = calculateBackoff;
/**
 * Pauses asynchronous execution for the given milliseconds
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Calculates exponential backoff with jitter
 * @param attempt 0-indexed attempt count
 * @param baseMs base backoff in ms (default 5000)
 * @param maxMs maximum backoff in ms (default 60000)
 */
function calculateBackoff(attempt, baseMs = 5000, maxMs = 60000) {
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
    // Add random jitter +/- 20%
    const jitter = (Math.random() - 0.5) * 0.4 * exponential;
    return Math.max(1000, Math.floor(exponential + jitter));
}
