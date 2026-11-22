import { execFile } from 'node:child_process';
import * as fs from 'node:fs';

export function runScript(config: Record<string, unknown>): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = String(config['path'] ?? '').trim();
  const inline = String(config['script'] ?? '').trim();
  const shell = String(config['shell'] ?? 'powershell').toLowerCase();
  if (scriptPath && fs.existsSync(scriptPath)) {
    return runScriptFile(shell, scriptPath);
  }
  if (inline) {
    return runInlineScript(shell, inline);
  }
  return Promise.resolve({ stdout: '', stderr: 'Script path missing or not found' });
}

function runInlineScript(shell: string, inline: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (shell === 'cmd') {
      execFile('cmd.exe', ['/d', '/c', inline], { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) =>
        resolve({ stdout: String(stdout), stderr: err ? String(err.message) + String(stderr) : String(stderr) })
      );
      return;
    }
    const exe = shell === 'bash' ? 'bash' : 'powershell.exe';
    const args = shell === 'bash' ? ['-lc', inline] : ['-NoProfile', '-NonInteractive', '-Command', inline];
    execFile(exe, args, { windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) =>
      resolve({ stdout: String(stdout), stderr: err ? String(err.message) + String(stderr) : String(stderr) })
    );
  });
}

function runScriptFile(shell: string, scriptPath: string): Promise<{ stdout: string; stderr: string }> {
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
