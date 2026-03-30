import { execFile } from 'node:child_process';

/** Best-effort volume via PowerShell COM (Windows). */
export function runAudioControl(config: Record<string, unknown>): Promise<string> {
  const volume = config['volume'];
  const mute = config['mute'];
  const script =
    mute === true
      ? `(New-Object -ComObject WScript.Shell).SendKeys([char]173)`
      : typeof volume === 'number'
        ? `$obj = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $obj.SendKeys([char]174) }; 1..${Math.min(100, Math.max(0, volume))} | ForEach-Object { $obj.SendKeys([char]175) }`
        : 'Write-Output "noop"';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? String(err.message) : String(stdout) || String(stderr) || 'ok');
    });
  });
}
