export interface MarketplaceTemplate {
  id: string;
  title: string;
  author: string;
  description: string;
  pro: boolean;
  nodes: Array<{ node_type: string; kind: string; config: Record<string, unknown> }>;
}

/** Built-in starter workflows shipped with the app (no third-party download or rating metrics). */
export const MARKETPLACE_ITEMS: MarketplaceTemplate[] = [
  {
    id: 'tmpl_meeting',
    title: 'Smart Meeting Prep',
    author: 'TaskForge',
    description: 'Example: time-based trigger plus a notification — customize times and message in the builder.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '*/5 * * * *', label: 'Every 5 min check' } },
      { node_type: 'action', kind: 'show_notification', config: { title: 'Meeting', body: 'Prep workflow', label: 'Notify' } },
    ],
  },
  {
    id: 'tmpl_dev',
    title: 'Dev Environment Setup',
    author: 'TaskForge',
    description: 'Example: run actions after login — replace paths with your own apps in the builder.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'system_startup', config: { label: 'On login' } },
      { node_type: 'action', kind: 'open_application', config: { path: 'code', label: 'Open VS Code' } },
    ],
  },
  {
    id: 'tmpl_social',
    title: 'Scheduled HTTP request',
    author: 'TaskForge',
    description: 'Example: POST to a URL on a schedule — set the real endpoint and body in the builder.',
    pro: true,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 12 * * *', label: 'Noon' } },
      { node_type: 'action', kind: 'http_request', config: { url: 'https://example.com/post', method: 'POST', label: 'HTTP Request' } },
    ],
  },
  {
    id: 'tmpl_db',
    title: 'Database Backup Pro',
    author: 'TaskForge',
    description: 'Example: periodic script run — point to your real backup script path in the builder.',
    pro: true,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 */4 * * *', label: 'Every 4 hours' } },
      { node_type: 'action', kind: 'run_script', config: { path: 'C:\\backup.ps1', shell: 'powershell', label: 'Run Script' } },
    ],
  },
  {
    id: 'tmpl_morning_startup',
    title: 'Morning Startup Routine',
    author: 'TaskForge',
    description: 'Weekday 9:00 AM — open browser and Slack (edit paths in builder).',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 9 * * 1-5', label: '9 AM Mon–Fri' } },
      { node_type: 'action', kind: 'open_application', config: { path: 'chrome', label: 'Open browser' } },
      { node_type: 'action', kind: 'show_notification', config: { title: 'Good morning', body: 'Startup routine', label: 'Notify' } },
    ],
  },
  {
    id: 'tmpl_clean_downloads',
    title: 'Clean Downloads (evening)',
    author: 'TaskForge',
    description: 'Late reminder to tidy downloads — replace with a real script path.',
    pro: true,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 23 * * *', label: '11 PM daily' } },
      { node_type: 'action', kind: 'run_script', config: { path: 'powershell', shell: 'powershell', label: 'Clean script' } },
    ],
  },
  {
    id: 'tmpl_shutdown_midnight',
    title: 'Shutdown reminder',
    author: 'TaskForge',
    description: 'Midnight notification — swap for a shutdown script if desired.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 0 * * *', label: 'Midnight' } },
      { node_type: 'action', kind: 'show_notification', config: { title: 'TaskForge', body: 'Time to shut down?', label: 'Reminder' } },
    ],
  },
  {
    id: 'tmpl_work_login',
    title: 'Work apps on login',
    author: 'TaskForge',
    description: 'On Windows login, launch common apps — set real executables.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'system_startup', config: { label: 'On login' } },
      { node_type: 'action', kind: 'open_application', config: { path: 'outlook', label: 'Mail' } },
      { node_type: 'action', kind: 'open_application', config: { path: 'ms-teams', label: 'Teams' } },
    ],
  },
  {
    id: 'tmpl_mute_headphones',
    title: 'Mute on disconnect (example)',
    author: 'TaskForge',
    description: 'Placeholder using device trigger — tune device type in builder.',
    pro: true,
    nodes: [
      { node_type: 'trigger', kind: 'device_connected', config: { label: 'Device', device: 'audio' } },
      { node_type: 'action', kind: 'audio_control', config: { action: 'mute', label: 'Mute' } },
    ],
  },
  {
    id: 'tmpl_dark_evening',
    title: 'Dark mode evening',
    author: 'TaskForge',
    description: 'Switch to dark theme at 7 PM.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 19 * * *', label: '7 PM' } },
      { node_type: 'action', kind: 'dark_mode_toggle', config: { mode: 'dark', label: 'Dark mode' } },
    ],
  },
  {
    id: 'tmpl_light_morning',
    title: 'Light mode morning',
    author: 'TaskForge',
    description: 'Light theme at 7 AM.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 7 * * *', label: '7 AM' } },
      { node_type: 'action', kind: 'dark_mode_toggle', config: { mode: 'light', label: 'Light mode' } },
    ],
  },
  {
    id: 'tmpl_cpu_alert',
    title: 'High CPU alert',
    author: 'TaskForge',
    description: 'CPU threshold trigger + notification (Pro).',
    pro: true,
    nodes: [
      { node_type: 'trigger', kind: 'cpu_memory_usage', config: { cpuPercent: 90, memPercent: 95, label: 'CPU > 90%' } },
      { node_type: 'action', kind: 'show_notification', config: { title: 'CPU', body: 'High usage', label: 'Alert' } },
    ],
  },
  {
    id: 'tmpl_welcome_startup',
    title: 'Welcome on startup',
    author: 'TaskForge',
    description: 'Friendly notification when you log in.',
    pro: false,
    nodes: [
      { node_type: 'trigger', kind: 'system_startup', config: { label: 'Startup' } },
      { node_type: 'action', kind: 'show_notification', config: { title: 'TaskForge', body: 'Ready to work.', label: 'Welcome' } },
    ],
  },
];
