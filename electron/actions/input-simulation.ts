import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

/**
 * Windows input simulation via PowerShell (no native addon).
 * - Keyboard: `{ "mode": "keyboard", "text": "hello{ENTER}" }` — SendKeys syntax
 * - Mouse click: `{ "mode": "click", "x": 100, "y": 200, "button": "left" }`
 */
export async function runInputSimulation(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'input_simulation is only implemented on Windows in this build' };
  }

  const mode = String(config['mode'] ?? 'keyboard').toLowerCase();
  if (mode === 'click') {
    return runMouseClick(config);
  }
  return runKeyboardInput(config);
}

async function runKeyboardInput(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const text = String(config['text'] ?? config['keys'] ?? '').trim();
  if (!text) return { ok: false, error: 'Keyboard mode needs non-empty text (SendKeys syntax)' };

  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    `$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))`,
    '[System.Windows.Forms.SendKeys]::SendWait($raw)',
  ].join('; ');

  return runPowerShell(ps);
}

async function runMouseClick(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const x = Math.round(Number(config['x'] ?? 0));
  const y = Math.round(Number(config['y'] ?? 0));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'Click mode needs numeric x and y coordinates' };
  }

  const button = String(config['button'] ?? 'left').toLowerCase();
  const downFlag =
    button === 'right' ? 'MOUSEEVENTF_RIGHTDOWN' : button === 'middle' ? 'MOUSEEVENTF_MIDDLEDOWN' : 'MOUSEEVENTF_LEFTDOWN';
  const upFlag =
    button === 'right' ? 'MOUSEEVENTF_RIGHTUP' : button === 'middle' ? 'MOUSEEVENTF_MIDDLEUP' : 'MOUSEEVENTF_LEFTUP';

  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class TfMouse {',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);',
    '  public const int MOUSEEVENTF_LEFTDOWN = 0x02;',
    '  public const int MOUSEEVENTF_LEFTUP = 0x04;',
    '  public const int MOUSEEVENTF_RIGHTDOWN = 0x08;',
    '  public const int MOUSEEVENTF_RIGHTUP = 0x10;',
    '  public const int MOUSEEVENTF_MIDDLEDOWN = 0x20;',
    '  public const int MOUSEEVENTF_MIDDLEUP = 0x40;',
    '}',
    '"@',
    `[TfMouse]::SetCursorPos(${x}, ${y}) | Out-Null`,
    `[TfMouse]::mouse_event([TfMouse]::${downFlag}, 0, 0, 0, 0)`,
    `[TfMouse]::mouse_event([TfMouse]::${upFlag}, 0, 0, 0, 0)`,
  ].join('\n');

  return runPowerShell(ps);
}

function runPowerShell(script: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
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
      else resolve({ ok: false, error: stderr.trim() || `PowerShell exited ${code}` });
    });
  });
}
