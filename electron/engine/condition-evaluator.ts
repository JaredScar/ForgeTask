import * as si from 'systeminformation';
import type { WorkflowNodeRow } from '../types';
import { interpolateConfigString } from './variable-interpolation';

/** Empty `expected` means any visible network. Otherwise the SSID must match exactly. */
export function wifiNetworkMatches(ssids: readonly string[], expected: string): boolean {
  return expected ? ssids.some((ssid) => ssid === expected) : ssids.length > 0;
}

/** `processName` is matched as a case-insensitive substring of a process name. */
export function processNameMatches(names: readonly (string | undefined)[], processName: string): boolean {
  const needle = processName.toLowerCase();
  return names.some((name) => name?.toLowerCase().includes(needle) === true);
}

export type ConditionProbe = {
  wifiNetworks?: () => Promise<Array<{ ssid?: string }>>;
  processes?: () => Promise<{ list?: Array<{ name?: string }> }>;
};

export async function evaluateCondition(
  node: WorkflowNodeRow,
  vars: Record<string, string> = {},
  context: Record<string, string> = {},
  probe?: ConditionProbe
): Promise<{ ok: boolean; reason?: string }> {
  let config: Record<string, unknown>;
  try {
    const raw = interpolateConfigString(node.config, vars, context);
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'Invalid condition config' };
  }

  switch (node.kind) {
    case 'wifi_network': {
      try {
        const expected = String(config['ssid'] ?? '');
        const wifi = probe?.wifiNetworks ? await probe.wifiNetworks() : await si.wifiNetworks();
        const ok = wifiNetworkMatches(
          wifi.map((w) => String(w.ssid ?? '')),
          expected
        );
        return ok ? { ok: true } : { ok: false, reason: `WiFi mismatch (expected ${expected})` };
      } catch {
        return { ok: true };
      }
    }
    case 'time_window': {
      const start = String(config['start'] ?? '09:00');
      const end = String(config['end'] ?? '17:00');
      const now = new Date();
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const mins = now.getHours() * 60 + now.getMinutes();
      const startM = sh * 60 + sm;
      const endM = eh * 60 + em;
      const ok = startM <= endM ? mins >= startM && mins <= endM : mins >= startM || mins <= endM;
      return ok ? { ok: true } : { ok: false, reason: 'Outside time window' };
    }
    case 'app_running': {
      const procName = String(config['process'] ?? '');
      const procs = probe?.processes ? await probe.processes() : await si.processes();
      const ok = processNameMatches(
        (procs.list ?? []).map((p) => p.name),
        procName
      );
      return ok ? { ok: true } : { ok: false, reason: `Process not running: ${procName}` };
    }
    default:
      return { ok: true };
  }
}
