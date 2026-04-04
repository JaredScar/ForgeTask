import { spawn } from 'node:child_process';
import * as path from 'node:path';

function spawnArgsFromConfig(config: Record<string, unknown>): string[] {
  const raw = config['args'];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x)).filter((s) => s.length > 0);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    return t.split(/\s+/).filter(Boolean);
  }
  return [];
}

export function runOpenApplication(config: Record<string, unknown>): Promise<void> {
  const exe = String(config['path'] ?? config['executable'] ?? 'notepad.exe');
  const args = spawnArgsFromConfig(config);
  return new Promise((resolve, reject) => {
    const isAbsolute = path.isAbsolute(exe);
    const useShell = !isAbsolute;
    const child = spawn(exe, args, {
      detached: true,
      stdio: 'ignore',
      shell: useShell,
      windowsHide: false,
    });
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
