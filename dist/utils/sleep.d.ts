/**
 * Pauses asynchronous execution for the given milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Calculates exponential backoff with jitter
 * @param attempt 0-indexed attempt count
 * @param baseMs base backoff in ms (default 5000)
 * @param maxMs maximum backoff in ms (default 60000)
 */
export declare function calculateBackoff(attempt: number, baseMs?: number, maxMs?: number): number;
