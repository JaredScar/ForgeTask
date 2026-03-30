import { execFile } from 'node:child_process';

/** Toggle Windows 10/11 apps light/dark theme via registry (best-effort). */
export function runDarkModeToggle(config: Record<string, unknown>): Promise<string> {
  const mode = String(config['mode'] ?? 'toggle').toLowerCase();
  return new Promise((resolve) => {
    const ps =
      mode === 'dark'
        ? `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value 0`
        : mode === 'light'
          ? `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value 1`
          : `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $c=(Get-ItemProperty $p).AppsUseLightTheme; Set-ItemProperty $p -Name AppsUseLightTheme -Value ([int](-not $c))`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? String(err.message) + String(stderr) : String(stdout) || 'ok');
    });
  });
}
