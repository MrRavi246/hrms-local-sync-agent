/**
 * Pauses asynchronous execution for the given milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff with jitter
 * @param attempt 0-indexed attempt count
 * @param baseMs base backoff in ms (default 5000)
 * @param maxMs maximum backoff in ms (default 60000)
 */
export function calculateBackoff(attempt: number, baseMs = 5000, maxMs = 60000): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  // Add random jitter +/- 20%
  const jitter = (Math.random() - 0.5) * 0.4 * exponential;
  return Math.max(1000, Math.floor(exponential + jitter));
}
