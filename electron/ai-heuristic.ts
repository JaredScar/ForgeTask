/**
 * PLAN §10.4 — keyword-based workflow draft when OpenAI is unavailable or in dev placeholder mode.
 * Returns a confidence score in [0, 1]; callers may show UX hints when confidence is low.
 */
export type HeuristicDraft = {
  name: string;
  nodes: Array<Record<string, unknown>>;
  source: 'heuristic';
  confidence: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function heuristicWorkflowFromPrompt(prompt: string): HeuristicDraft {
  if (prompt.trim().length < 6) {
    return {
      name: 'Need more detail',
      source: 'heuristic',
      confidence: 0.2,
      nodes: [
        {
          node_type: 'trigger',
          kind: 'time_schedule',
          config: { cron: '0 9 * * *', label: 'Time: 9:00 AM' },
          sort_order: 0,
        },
        {
          node_type: 'action',
          kind: 'show_notification',
          config: {
            title: 'TaskForge',
            body: 'Describe a trigger (when) and an action (what) more specifically — e.g. “every weekday at 9am open Outlook”.',
            label: 'Show Notification',
          },
          sort_order: 1,
        },
      ],
    };
  }

  const lower = prompt.toLowerCase();
  const nodes: Array<Record<string, unknown>> = [];
  let order = 0;
  let triggerConf = 0.35;
  let actionConf = 0.35;

  if (lower.includes('plug in') || lower.includes('headphone') || (lower.includes('device') && !lower.includes('usb'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'device_connected',
      config: { label: 'Device', device: 'audio', event: 'connect' },
      sort_order: order++,
    });
    triggerConf = 0.72;
  } else if (lower.includes('usb') && (lower.includes('connect') || lower.includes('plug') || lower.includes('device'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'device_trigger',
      config: { label: 'USB change', event: 'any' },
      sort_order: order++,
    });
    triggerConf = 0.7;
  } else if (lower.includes('idle')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'idle_trigger',
      config: { idleSeconds: lower.includes('5 min') ? 300 : lower.includes('10 min') ? 600 : 900, label: 'When idle' },
      sort_order: order++,
    });
    triggerConf = 0.68;
  } else if (lower.includes('memory') || lower.includes('ram')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'memory_trigger',
      config: { threshold: 85, comparison: 'above', label: 'Memory high' },
      sort_order: order++,
    });
    triggerConf = 0.7;
  } else if (lower.includes('lock') && (lower.includes('screen') || lower.includes('workstation') || lower.includes('win+l'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'system_startup',
      config: { label: 'On startup (example — edit trigger)' },
      sort_order: order++,
    });
    triggerConf = 0.48;
  } else if (lower.includes('midnight') || lower.includes('12 am') || lower.includes('12:00 am')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 0 * * *', label: 'Daily at midnight' },
      sort_order: order++,
    });
    triggerConf = 0.78;
  } else if (lower.includes('sunset') || lower.includes('evening') || lower.includes('7 pm') || lower.includes('7pm')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 19 * * *', label: 'Daily 7 PM' },
      sort_order: order++,
    });
    triggerConf = 0.55;
  } else if (lower.includes('sunrise') || lower.includes('morning') && (lower.includes('7 am') || lower.includes('7am'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 7 * * *', label: 'Daily 7 AM' },
      sort_order: order++,
    });
    triggerConf = 0.55;
  } else if (lower.includes('startup') || lower.includes('sign in') || lower.includes('sign-in') || lower.includes('login') || lower.includes('boot')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'system_startup',
      config: { label: 'On startup' },
      sort_order: order++,
    });
    triggerConf = 0.75;
  } else if (lower.includes('wifi') || lower.includes('ssid') || (lower.includes('network') && lower.includes('connect'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'network_change',
      config: { ssid: '', label: 'Network change' },
      sort_order: order++,
    });
    triggerConf = 0.68;
  } else if (lower.includes('file') && (lower.includes('change') || lower.includes('watch') || lower.includes('folder'))) {
    nodes.push({
      node_type: 'trigger',
      kind: 'file_change',
      config: { path: '', label: 'File change' },
      sort_order: order++,
    });
    triggerConf = 0.7;
  } else if (lower.includes('cpu') || lower.includes('processor')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'cpu_memory_usage',
      config: { cpuPercent: 90, memPercent: 95, label: 'CPU high' },
      sort_order: order++,
    });
    triggerConf = 0.72;
  } else if (lower.includes('every hour') || lower.includes('hourly')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 * * * *', label: 'Time: hourly' },
      sort_order: order++,
    });
    triggerConf = 0.65;
  } else if (lower.includes('weekday') || lower.includes('monday') || lower.includes('friday') || lower.includes('work day')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: lower.includes('9') ? '0 9 * * 1-5' : '0 9 * * 1-5', label: 'Weekdays 9 AM' },
      sort_order: order++,
    });
    triggerConf = 0.62;
  } else if (lower.includes('morning') || lower.includes('every day') || lower.includes('daily')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 9 * * *', label: 'Time: 9:00 AM' },
      sort_order: order++,
    });
    triggerConf = 0.58;
  } else if (lower.includes('remind') || lower.includes('reminder') || lower.includes('notify me')) {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 9 * * *', label: 'Time: 9:00 AM' },
      sort_order: order++,
    });
    triggerConf = 0.5;
  } else {
    nodes.push({
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron: '0 * * * *', label: 'Time: hourly' },
      sort_order: order++,
    });
    triggerConf = 0.32;
  }

  if (lower.includes('lock') && lower.includes('screen') && nodes.length > 0) {
    nodes.push({
      node_type: 'action',
      kind: 'lock_workstation',
      config: { label: 'Lock screen' },
      sort_order: order++,
    });
    actionConf = 0.75;
  } else if (lower.includes('shutdown') || lower.includes('shut down')) {
    nodes.push({
      node_type: 'action',
      kind: 'run_script',
      config: { path: '', shell: 'powershell', script: 'shutdown /s /t 60', label: 'Shutdown (example)' },
      sort_order: order++,
    });
    actionConf = 0.55;
  } else if (lower.includes('dark mode') || lower.includes('light mode') || lower.includes('theme')) {
    nodes.push({
      node_type: 'action',
      kind: 'dark_mode_toggle',
      config: { mode: lower.includes('light') ? 'disable' : 'enable', label: 'Theme' },
      sort_order: order++,
    });
    actionConf = 0.68;
  } else if (lower.includes('mute') || lower.includes('unmute') || lower.includes('volume')) {
    nodes.push({
      node_type: 'action',
      kind: 'audio_control',
      config: { action: lower.includes('unmute') ? 'unmute' : 'mute', label: 'Audio' },
      sort_order: order++,
    });
    actionConf = 0.7;
  } else if (lower.includes('chrome')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'chrome.exe', label: 'Open Chrome' },
      sort_order: order++,
    });
    actionConf = 0.78;
  } else if (lower.includes('spotify')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'spotify.exe', label: 'Open Spotify' },
      sort_order: order++,
    });
    actionConf = 0.78;
  } else if (lower.includes('slack')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'slack.exe', label: 'Open Slack' },
      sort_order: order++,
    });
    actionConf = 0.75;
  } else if (lower.includes('teams') || lower.includes('microsoft teams')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'ms-teams.exe', label: 'Open Teams' },
      sort_order: order++,
    });
    actionConf = 0.72;
  } else if (lower.includes('outlook') || lower.includes('mail')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'outlook.exe', label: 'Open Outlook' },
      sort_order: order++,
    });
    actionConf = 0.7;
  } else if (lower.includes('vscode') || lower.includes('vs code') || lower.includes('code.exe')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'code.exe', label: 'Open VS Code' },
      sort_order: order++,
    });
    actionConf = 0.72;
  } else if (lower.includes('notepad')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'notepad.exe', label: 'Open Notepad' },
      sort_order: order++,
    });
    actionConf = 0.75;
  } else if (lower.includes('script') || lower.includes('powershell') || lower.includes('shell') || lower.includes('bash')) {
    nodes.push({
      node_type: 'action',
      kind: 'run_script',
      config: { path: '', shell: lower.includes('bash') ? 'bash' : 'powershell', label: 'Run script' },
      sort_order: order++,
    });
    actionConf = 0.74;
  } else if (
    (lower.includes('http') || lower.includes('post ') || lower.includes('webhook') || lower.includes('api ') || lower.includes('request')) &&
    !lower.includes('download')
  ) {
    nodes.push({
      node_type: 'action',
      kind: 'http_request',
      config: { method: lower.includes('post') ? 'POST' : 'GET', url: 'https://example.com', label: 'HTTP request' },
      sort_order: order++,
    });
    actionConf = 0.72;
  } else if (lower.includes('zip') || lower.includes('archive')) {
    nodes.push({
      node_type: 'action',
      kind: 'zip_archive',
      config: { sources: '', outputPath: '', label: 'Create ZIP' },
      sort_order: order++,
    });
    actionConf = 0.55;
  } else if (lower.includes('download') && lower.includes('http')) {
    nodes.push({
      node_type: 'action',
      kind: 'download_file',
      config: { url: 'https://', destPath: '', label: 'Download' },
      sort_order: order++,
    });
    actionConf = 0.55;
  } else if (lower.includes('screenshot')) {
    nodes.push({
      node_type: 'action',
      kind: 'screenshot_save',
      config: { path: '', label: 'Screenshot' },
      sort_order: order++,
    });
    actionConf = 0.65;
  } else if (lower.includes('clipboard') || lower.includes('copy text')) {
    nodes.push({
      node_type: 'action',
      kind: 'clipboard_write',
      config: { text: '', label: 'Clipboard' },
      sort_order: order++,
    });
    actionConf = 0.62;
  } else if (lower.includes('open url') || lower.includes('browser') && lower.includes('http')) {
    nodes.push({
      node_type: 'action',
      kind: 'open_url',
      config: { url: 'https://', label: 'Open URL' },
      sort_order: order++,
    });
    actionConf = 0.6;
  } else if (lower.includes('backup') || (lower.includes('copy') && lower.includes('folder'))) {
    nodes.push({
      node_type: 'action',
      kind: 'file_operation',
      config: { operation: 'copy', source: '', destination: '', label: 'File copy' },
      sort_order: order++,
    });
    actionConf = 0.52;
  } else if (lower.includes('open ') && (lower.includes('app') || lower.includes('application'))) {
    nodes.push({
      node_type: 'action',
      kind: 'open_application',
      config: { path: 'notepad.exe', label: 'Open application' },
      sort_order: order++,
    });
    actionConf = 0.55;
  } else {
    nodes.push({
      node_type: 'action',
      kind: 'show_notification',
      config: { title: 'TaskForge', body: prompt.slice(0, 160), label: 'Show Notification' },
      sort_order: order++,
    });
    actionConf = 0.42;
  }

  const confidence = clamp((triggerConf + actionConf) / 2 + (prompt.split(/\s+/).filter(Boolean).length >= 10 ? 0.04 : 0), 0.22, 0.95);

  return {
    name: 'Heuristic: ' + prompt.slice(0, 44),
    source: 'heuristic',
    confidence,
    nodes,
  };
}
