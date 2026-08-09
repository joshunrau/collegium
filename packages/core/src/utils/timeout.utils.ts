/**
 * Races an operation against a deadline, always clearing the timer. `onTimeout` decides the
 * outcome: return a fallback to resolve with it, or throw to reject the race.
 */
export async function withTimeout<TValue, TFallback = never>(
  operation: Promise<TValue>,
  timeoutMs: number,
  onTimeout: () => TFallback
): Promise<TFallback | TValue> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<TFallback>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
