import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
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

function normalizeExe(config: Record<string, unknown>): string {
  const raw = String(config['path'] ?? config['executable'] ?? 'notepad.exe').trim();
  return raw.replace(/^["']+|["']+$/g, '');
}

/** Absolute or relative path to a concrete .exe file (not a bare PATH name like `code`). */
function resolveWindowsExeFile(exe: string): string | null {
  const abs = path.win32.isAbsolute(exe) || path.isAbsolute(exe);
  if (abs) {
    return path.normalize(exe);
  }
  if (/[/\\]/.test(exe)) {
    return path.normalize(path.resolve(process.cwd(), exe));
  }
  return null;
}

/**
 * Launch a desktop or console program. On Windows we avoid `shell: true` for PATH-only names
 * (see comment in history). For a concrete `.exe` path, CLI tools like ngrok need `start` so
 * they get their own console; direct `spawn` from the GUI main process often exits immediately.
 */
export function runOpenApplication(config: Record<string, unknown>): Promise<void> {
  const exe = normalizeExe(config);
  if (!exe) {
    return Promise.reject(new Error('No executable path configured'));
  }
  const args = spawnArgsFromConfig(config);
  const onWin = process.platform === 'win32';
  const ext = path.extname(exe).toLowerCase();

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    if (onWin && ext === '.ps1') {
      const script = path.isAbsolute(exe) ? path.normalize(exe) : path.resolve(process.cwd(), exe);
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
        { detached: true, stdio: 'ignore', windowsHide: false, shell: false }
      );
    } else if (onWin && (ext === '.bat' || ext === '.cmd')) {
      const batch = path.isAbsolute(exe) ? path.normalize(exe) : path.resolve(process.cwd(), exe);
      child = spawn('cmd.exe', ['/c', 'call', batch, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
      });
    } else if (onWin && ext === '.exe') {
      const filePath = resolveWindowsExeFile(exe);
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          reject(new Error(`Executable not found: ${filePath}`));
          return;
        }
        const cwd = path.dirname(filePath);
        // `start "" <exe> …` — new console for CLI apps (ngrok, etc.); empty arg is window title.
        child = spawn('cmd.exe', ['/c', 'start', '', filePath, ...args], {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: false,
        });
      } else {
        child = spawn(exe, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: false,
        });
      }
    } else {
      child = spawn(exe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
      });
    }

    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
