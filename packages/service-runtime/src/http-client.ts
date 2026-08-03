export const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
export const MAX_FETCH_TIMEOUT_MS = 300_000;

export class FetchTimeoutError extends Error {
  readonly code = 'FETCH_TIMEOUT';

  constructor(
    readonly timeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(`outbound request timed out after ${timeoutMs}ms`, options);
    this.name = 'FetchTimeoutError';
  }
}

function checkedTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FETCH_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer between 1 and ${MAX_FETCH_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

/** Fetch with a bounded deadline while retaining any caller-provided cancellation signal. */
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(checkedTimeout(timeoutMs));
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new FetchTimeoutError(timeoutMs, { cause: error });
    }
    throw error;
  }
}
