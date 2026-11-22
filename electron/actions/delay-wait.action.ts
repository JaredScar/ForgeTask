/** `delayMs` wins when set; otherwise `delaySeconds` is converted. Clamped to 100ms–1h. */
export function delayWaitMs(config: Record<string, unknown>): number {
  const requested =
    config['delayMs'] != null
      ? Number(config['delayMs'])
      : config['delaySeconds'] != null
        ? Number(config['delaySeconds']) * 1000
        : 1000;
  const ms = Number.isFinite(requested) ? requested : 1000;
  return Math.max(100, Math.min(3_600_000, ms));
}

/** Pauses workflow execution for a fixed duration (Pro). */
export async function runDelayWait(config: Record<string, unknown>): Promise<{ waited: number }> {
  const ms = delayWaitMs(config);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { waited: ms };
}
