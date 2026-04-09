import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Ceiling on a single backoff wait, so a high attempt count cannot stall a poll cycle for hours. */
  maxDelayMs: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Included in the retry log line so a failure can be traced to an operation. */
  label?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff delay for `attempt` (1-based), clamped to `maxDelayMs`. */
export function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const raw = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(raw, maxDelayMs);
}

/**
 * Runs `fn`, retrying on rejection with exponential backoff. Rethrows the last
 * error once the attempts are exhausted — callers decide whether that is fatal.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    sleep = defaultSleep,
    label = "operation",
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === maxAttempts;
      const delayMs = isLast ? 0 : backoffDelayMs(attempt, baseDelayMs, maxDelayMs);

      logger.warn({ label, attempt, maxAttempts, delayMs, err }, "Attempt failed");

      if (!isLast) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
