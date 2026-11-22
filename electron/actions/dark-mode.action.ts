import { execFile } from 'node:child_process';

/**
 * AppsUseLightTheme: 0 is dark, 1 is light.
 * The settings UI uses enable/disable; older configs use dark/light.
 */
export function darkModeScript(mode: unknown): string {
  const m = String(mode ?? 'toggle').toLowerCase();
  if (m === 'dark' || m === 'enable') {
    return `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value 0`;
  }
  if (m === 'light' || m === 'disable') {
    return `Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Value 1`;
  }
  return `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $c=(Get-ItemProperty $p).AppsUseLightTheme; Set-ItemProperty $p -Name AppsUseLightTheme -Value ([int](-not $c))`;
}

/** Toggle Windows 10/11 apps light/dark theme via registry (best-effort). */
export function runDarkModeToggle(config: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const ps = darkModeScript(config['mode']);
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout, stderr) => {
      resolve(err ? String(err.message) + String(stderr) : String(stdout) || 'ok');
    });
  });
}
