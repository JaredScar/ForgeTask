import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

/**
 * Windows: SendKeys via PowerShell + System.Windows.Forms (no native addon).
 * Config: `{ "text": "hello{ENTER}" }` — see SendKeys escape rules for specials.
 */
export async function runInputSimulation(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const text = String(config['text'] ?? config['keys'] ?? '').trim();
  if (!text) return { ok: false, error: 'input_simulation needs non-empty text (or keys)' };

  if (process.platform !== 'win32') {
    return { ok: false, error: 'input_simulation is only implemented on Windows in this build' };
  }

  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    `$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))`,
    '[System.Windows.Forms.SendKeys]::SendWait($raw)',
  ].join('; ');

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (e) => {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.trim() || `SendKeys exited ${code}` });
    });
  });
}
