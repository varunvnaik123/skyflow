export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(delayMs: number): number {
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(delayMs * 0.2)));
  return delayMs + jitter;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts) {
        break;
      }

      const exponential = options.baseDelayMs * 2 ** (attempt - 1);
      const delay = Math.min(options.maxDelayMs, withJitter(exponential));
      await sleep(delay);
    }
  }

  throw lastError;
}
