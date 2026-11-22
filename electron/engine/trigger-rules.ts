/** Pure firing rules for every catalog trigger. The trigger manager applies these to live samples. */

export const POWER_EVENTS = ['on-ac', 'on-battery', 'resume', 'suspend', 'lock-screen', 'unlock-screen', 'shutdown'] as const;

const POWER_EVENT_SET = new Set<string>(POWER_EVENTS);

export const POLL_TRIGGER_KINDS = [
  'app_launch',
  'cpu_memory_usage',
  'device_connected',
  'idle_trigger',
  'memory_trigger',
  'device_trigger',
  'process_exit',
  'window_focus',
  'display_change',
  'clipboard_monitor',
] as const;

export type TriggerBinding =
  | { mode: 'cron' }
  | { mode: 'startup' }
  | { mode: 'interval'; minutes: number }
  | { mode: 'power'; event: string | null }
  | { mode: 'network' }
  | { mode: 'watch'; path: string }
  | { mode: 'poll' }
  | { mode: 'webhook' }
  | { mode: 'ignore' };

export function triggerBinding(kind: string, config: Record<string, unknown> = {}): TriggerBinding {
  switch (kind) {
    case 'time_schedule':
      return { mode: 'cron' };
    case 'system_startup':
      return { mode: 'startup' };
    case 'interval_trigger':
      return { mode: 'interval', minutes: clampIntervalMinutes(config['intervalMinutes']) };
    case 'power_event':
      return { mode: 'power', event: normalizePowerEvent(config['event']) };
    case 'network_change':
      return { mode: 'network' };
    case 'file_change':
      return { mode: 'watch', path: String(config['path'] ?? '').trim() };
    case 'webhook_trigger':
      return { mode: 'webhook' };
    default:
      return (POLL_TRIGGER_KINDS as readonly string[]).includes(kind) ? { mode: 'poll' } : { mode: 'ignore' };
  }
}

export function clampIntervalMinutes(raw: unknown): number {
  const n = Number(raw ?? 30);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(24 * 60, Math.floor(n)));
}

export function normalizePowerEvent(raw: unknown): string | null {
  const ev = String(raw ?? 'resume').trim();
  return POWER_EVENT_SET.has(ev) ? ev : null;
}

export function processMatchesConfig(processField: string, procName?: string): boolean {
  if (!procName || !processField.trim()) return false;
  const want = processField.trim().toLowerCase().replace(/\.exe$/i, '');
  const name = procName.toLowerCase();
  const base = name.replace(/\.exe$/i, '');
  return name === want || base === want || name.includes(want) || base.includes(want);
}

/** App launch fires on the rising edge only, so a process that stays open does not retrigger. */
export function appLaunchShouldFire(wasRunning: boolean, running: boolean): boolean {
  return running && !wasRunning;
}

/** Process exit fires when a process that was running is gone. */
export function processExitShouldFire(wasRunning: boolean, running: boolean): boolean {
  return !running && wasRunning;
}

/**
 * CPU wins when both thresholds jump in the same sample. A trigger requires the
 * reading to clear its threshold and to have risen more than 5 points since the last poll.
 */
export function cpuMemoryFireReason(input: {
  cpu: number;
  usedPct: number;
  cpuThreshold: number;
  memThreshold: number;
  lastCpu: number;
  lastMem: number;
}): 'cpu' | 'memory' | null {
  const cpuHot = input.cpu >= input.cpuThreshold && input.cpu > input.lastCpu + 5;
  const memHot = input.usedPct >= input.memThreshold && input.usedPct > input.lastMem + 5;
  if (!(input.cpu >= input.cpuThreshold || input.usedPct >= input.memThreshold)) return null;
  if (cpuHot) return 'cpu';
  if (memHot) return 'memory';
  return null;
}

export function idleShouldFire(idleSec: number, idleSecondsConfig: unknown, lastFireMs: number, now: number): boolean {
  const need = Math.max(1, Number(idleSecondsConfig ?? 300));
  if (!Number.isFinite(need) || idleSec < need) return false;
  return now - lastFireMs > 60_000;
}

export function memoryThresholdMet(usedPct: number, threshold: unknown, comparison: unknown): boolean {
  const th = Number(threshold ?? 85);
  if (!Number.isFinite(th)) return false;
  const below = String(comparison ?? 'above').toLowerCase() === 'below';
  return below ? usedPct <= th : usedPct >= th;
}

export function cooledDown(lastFireMs: number, now: number, cooldownMs: number): boolean {
  return now - lastFireMs > cooldownMs;
}

/**
 * `connect` is a count increase, `disconnect` a decrease. Any other event (including empty) is any change.
 * The first sample only sets a baseline.
 */
export function deviceCountShouldFire(previous: number | null, next: number, event: unknown): boolean {
  if (previous == null || !Number.isFinite(next)) return false;
  const ev = String(event ?? 'any').trim().toLowerCase();
  if (ev === 'connect') return next > previous;
  if (ev === 'disconnect') return next < previous;
  return next !== previous;
}

/**
 * USB is the default class. `any` fires when either USB or audio changes in the requested direction.
 * Each class keeps its own baseline, so the first sample does not fire.
 */
export function deviceTriggerShouldFire(input: {
  deviceType: unknown;
  event: unknown;
  previousUsb: number | null;
  previousAudio: number | null;
  usb: number;
  audio: number;
}): boolean {
  const type = String(input.deviceType ?? 'usb').trim().toLowerCase();
  if (type === 'audio') return deviceCountShouldFire(input.previousAudio, input.audio, input.event);
  if (type === 'any') {
    return (
      deviceCountShouldFire(input.previousUsb, input.usb, input.event) ||
      deviceCountShouldFire(input.previousAudio, input.audio, input.event)
    );
  }
  return deviceCountShouldFire(input.previousUsb, input.usb, input.event);
}

/** Device-connected watches one class and fires when that class gains a device. */
export function deviceConnectedShouldFire(previous: number | null, next: number): boolean {
  return deviceCountShouldFire(previous, next, 'connect');
}

export function networkMatches(ssids: string[], expectedSsid: string): boolean {
  const expected = expectedSsid.trim();
  if (!expected) return ssids.length > 0;
  return ssids.some((ssid) => ssid === expected);
}

export function clipboardShouldFire(previous: string | null, current: string, filter: unknown): boolean {
  if (previous == null || current === previous) return false;
  const needle = String(filter ?? '').trim().toLowerCase();
  if (!needle) return true;
  return current.toLowerCase().includes(needle);
}

export function displayShouldFire(previous: number | null, next: number): boolean {
  return previous != null && next !== previous;
}

/** Fires when the foreground title newly contains `windowTitle`. Empty titles never match. */
export function windowFocusShouldFire(previousTitle: string | null, currentTitle: string, windowTitle: unknown): boolean {
  const needle = String(windowTitle ?? '').trim().toLowerCase();
  if (!needle || previousTitle == null) return false;
  const matches = (title: string) => title.toLowerCase().includes(needle);
  return matches(currentTitle) && !matches(previousTitle);
}

/** Power events from the same node are ignored for 3 seconds so resume/lock pairs do not double-fire. */
export function powerEventShouldFire(lastFireMs: number, now: number): boolean {
  return now - lastFireMs >= 3_000;
}

/** A missed cron is due when the previous scheduled instant is newer than the last fire, with 500ms of slack. */
export function missedCronShouldReplay(lastFiredMs: number, previousScheduledMs: number): boolean {
  return lastFiredMs < previousScheduledMs - 500;
}
