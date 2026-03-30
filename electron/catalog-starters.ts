/** Default node configs when creating a workflow from the Triggers / Actions catalog. */

export function defaultTriggerConfig(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'time_schedule':
      return { cron: '0 9 * * *', label: '9:00 AM daily' };
    case 'app_launch':
      return { process: 'notepad.exe', label: 'When app opens' };
    case 'system_startup':
      return { label: 'On Windows login' };
    case 'network_change':
      return { ssid: '', label: 'WiFi / network change' };
    case 'file_change':
      return { path: '', label: 'File or folder watch' };
    case 'cpu_memory_usage':
      return { cpuPercent: 90, memPercent: 90, label: 'CPU or memory threshold' };
    case 'device_connected':
      return { device: 'audio', label: 'Device connected' };
    default:
      return { label: kind };
  }
}

export function defaultActionConfig(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'open_application':
      return { path: 'notepad.exe', label: 'Open application' };
    case 'show_notification':
      return { title: 'TaskForge', body: 'Notification text', label: 'Show notification' };
    case 'open_file_folder':
      return { path: '', label: 'Open file or folder' };
    case 'dark_mode_toggle':
      return { mode: 'toggle', label: 'Dark mode' };
    case 'audio_control':
      return { action: 'mute', label: 'Audio control' };
    case 'run_script':
      return { path: '', shell: 'powershell', label: 'Run script' };
    case 'http_request':
      return { method: 'GET', url: 'https://example.com', label: 'HTTP request' };
    default:
      return { label: kind };
  }
}

/** Placeholder schedule so an action-only starter still has a runnable trigger chain. */
export function stubTimeTriggerConfig(): Record<string, unknown> {
  return { cron: '0 9 * * *', label: '9:00 AM daily (edit or replace)' };
}
