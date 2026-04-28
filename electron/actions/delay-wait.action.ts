/** Pauses workflow execution for a fixed duration (Pro). */
export async function runDelayWait(config: Record<string, unknown>): Promise<{ waited: number }> {
  const ms = Math.max(100, Math.min(3_600_000, Number(config['delayMs'] ?? config['delaySeconds'] != null ? Number(config['delaySeconds']) * 1000 : 1000)));
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
  return { waited: ms };
}
