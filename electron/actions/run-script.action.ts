import { execFile } from 'node:child_process';
import * as fs from 'node:fs';

export function runScript(config: Record<string, unknown>): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = String(config['path'] ?? '');
  const shell = String(config['shell'] ?? 'powershell').toLowerCase();
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return Promise.resolve({ stdout: '', stderr: 'Script path missing or not found' });
  }
  return new Promise((resolve) => {
    if (shell === 'powershell' || shell === 'pwsh') {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, timeout: 120_000 },
        (err, stdout, stderr) => resolve({ stdout: String(stdout), stderr: err ? String(err.message) + String(stderr) : String(stderr) })
      );
    } else {
      execFile('cmd.exe', ['/c', scriptPath], { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) =>
        resolve({ stdout: String(stdout), stderr: err ? String(err.message) + String(stderr) : String(stderr) })
      );
    }
  });
}
