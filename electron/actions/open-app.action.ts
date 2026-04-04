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

/**
 * `start` treats the first quoted token as the window title. A single word is often *not* quoted
 * by Node’s Windows argv builder, so cmd thinks that word is the program name (e.g. “cannot find TaskForge”).
 * A title with a space is always quoted → `start "TaskForge run" /D … "exe" …`.
 */
const WIN_START_TITLE = 'TaskForge run';

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
 * Launch a program. Windows:
 * - PATH-only names: direct `spawn` (no `shell: true`).
 * - Full path to `.exe`: `cmd /d /c start "<title>" /D <cwd> <exe> [args…]` as separate argv entries.
 *   Do **not** use `cmd /s /c "one big string"` — `/S` strips first/last `"` from the /C string; when Node
 *   wraps that string in quotes, the line is corrupted and Windows may try to run `\\` or other garbage.
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
    if (onWin && ext === '.exe') {
      const filePath = resolveWindowsExeFile(exe);
      if (filePath) {
        if (!fs.existsSync(filePath)) {
          reject(new Error(`Executable not found: ${filePath}`));
          return;
        }
        const cwd = path.dirname(filePath);
        const childCmd = spawn(
          'cmd.exe',
          ['/d', '/c', 'start', WIN_START_TITLE, '/D', cwd, filePath, ...args],
          {
            stdio: 'ignore',
            windowsHide: false,
            shell: false,
            detached: false,
          }
        );
        childCmd.on('error', reject);
        childCmd.once('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          const direct = spawn(filePath, args, {
            cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
            shell: false,
          });
          direct.on('error', (err) =>
            reject(new Error(`Could not start program (cmd exit ${code ?? 'unknown'}; ${err.message})`))
          );
          direct.once('spawn', () => {
            direct.unref();
            resolve();
          });
        });
        return;
      }
    }

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
