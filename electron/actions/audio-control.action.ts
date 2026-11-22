import { execFile } from 'node:child_process';

export type AudioPlan = 'mute' | 'unmute' | 'volume' | 'noop';

/** The settings UI stores `action`. Older configs stored `mute: true` or a numeric `volume`. */
export function audioControlPlan(config: Record<string, unknown>): AudioPlan {
  const action = String(config['action'] ?? '').trim().toLowerCase();
  if (config['mute'] === true || action === 'mute') return 'mute';
  if (action === 'unmute') return 'unmute';
  if (action === 'set-volume' || typeof config['volume'] === 'number') return 'volume';
  return 'noop';
}

export function audioControlScript(config: Record<string, unknown>): string {
  const plan = audioControlPlan(config);
  if (plan === 'mute') return `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`;
  if (plan === 'unmute') return `(New-Object -ComObject WScript.Shell).SendKeys([char]175)`;
  if (plan === 'volume') {
    const raw = Number(config['volume'] ?? 0);
    const volume = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
    return `$obj = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $obj.SendKeys([char]174) }; 1..${volume} | ForEach-Object { $obj.SendKeys([char]175) }`;
  }
  return 'Write-Output "noop"';
}

/** Best-effort volume via PowerShell COM (Windows). */
export function runAudioControl(config: Record<string, unknown>): Promise<string> {
  const script = audioControlScript(config);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? String(err.message) : String(stdout) || String(stderr) || 'ok');
    });
  });
}
