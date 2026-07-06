import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { FREE_WORKFLOW_LIMIT, isProEnterpriseUnlocked } from './entitlement';

export type TaskSchedulerImportNode = {
  node_type: 'trigger' | 'action';
  kind: string;
  config: Record<string, unknown>;
};

export type TaskSchedulerImportDraft = {
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  nodes: TaskSchedulerImportNode[];
  warnings: string[];
};

export type ImportTaskSchedulerResult =
  | { ok: true; imported: number; skipped: number; workflowIds: string[]; warnings: string[] }
  | { ok: false; error: string };

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Decode Windows Task Scheduler export (UTF-8 or UTF-16 LE/BE with BOM). */
export function decodeTaskSchedulerXmlBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le').replace(/^\uFEFF/, '');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]!;
      swapped[i - 1] = buffer[i]!;
    }
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function getElementBlock(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m?.[0] ?? null;
}

function getAllElementBlocks(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
  return [...block.matchAll(re)].map((m) => m[0]!);
}

function getElementText(block: string, tag: string): string | null {
  const el = getElementBlock(block, tag);
  if (!el) return null;
  const inner = el.replace(new RegExp(`^<${tag}\\b[^>]*>`, 'i'), '').replace(new RegExp(`<\\/${tag}>$`, 'i'), '');
  if (/<[a-z]/i.test(inner)) return null;
  return inner.trim();
}

function isTruthyXml(value: string | null | undefined): boolean {
  if (value == null) return true;
  const v = value.trim().toLowerCase();
  return v !== 'false' && v !== '0';
}

function parseStartBoundaryTime(startBoundary: string | null): { hour: number; minute: number } {
  if (!startBoundary) return { hour: 9, minute: 0 };
  const m = startBoundary.match(/T(\d{2}):(\d{2})/);
  if (!m) return { hour: 9, minute: 0 };
  return { hour: parseInt(m[1]!, 10), minute: parseInt(m[2]!, 10) };
}

function parseIsoDurationMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const days = parseInt(m[1] ?? '0', 10);
  const hours = parseInt(m[2] ?? '0', 10);
  const minutes = parseInt(m[3] ?? '0', 10);
  const seconds = parseInt(m[4] ?? '0', 10);
  const total = days * 24 * 60 + hours * 60 + minutes + Math.max(1, Math.ceil(seconds / 60));
  return total > 0 ? total : null;
}

function cronFromTime(hour: number, minute: number, dayOfMonth?: number, daysOfWeek?: number[]): string {
  const dom = dayOfMonth != null ? String(dayOfMonth) : '*';
  const dow = daysOfWeek?.length ? daysOfWeek.join(',') : '*';
  return `${minute} ${hour} ${dom} * ${dow}`;
}

function parseDaysOfWeek(block: string | null): number[] | undefined {
  if (!block) return undefined;
  const found: number[] = [];
  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (new RegExp(`<${DAY_NAMES[i]!}(?:\\s|\\/?>)`, 'i').test(block)) found.push(i);
  }
  return found.length ? found : undefined;
}

function taskNameFromUri(uri: string | null): string | null {
  if (!uri?.trim()) return null;
  const parts = uri.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : null;
}

function mapCalendarTrigger(triggerBlock: string): TaskSchedulerImportNode | null {
  const start = getElementText(triggerBlock, 'StartBoundary');
  const { hour, minute } = parseStartBoundaryTime(start);
  const scheduleByDay = getElementBlock(triggerBlock, 'ScheduleByDay');
  const scheduleByWeek = getElementBlock(triggerBlock, 'ScheduleByWeek');
  const scheduleByMonth = getElementBlock(triggerBlock, 'ScheduleByMonth');
  const scheduleByMonthDow = getElementBlock(triggerBlock, 'ScheduleByMonthDayOfWeek');

  if (scheduleByWeek) {
    const days = parseDaysOfWeek(getElementBlock(scheduleByWeek, 'DaysOfWeek'));
    const cron = cronFromTime(hour, minute, undefined, days);
    const label = days?.length
      ? `Weekly ${formatDays(days)} at ${formatTime(hour, minute)}`
      : `Weekly at ${formatTime(hour, minute)}`;
    return { node_type: 'trigger', kind: 'time_schedule', config: { cron, label } };
  }

  if (scheduleByMonth) {
    const dayText = getElementText(scheduleByMonth, 'Day') ?? getElementText(getElementBlock(scheduleByMonth, 'DaysOfMonth') ?? '', 'Day');
    const dom = dayText ? parseInt(dayText, 10) : 1;
    const cron = cronFromTime(hour, minute, Number.isFinite(dom) ? dom : 1);
    return {
      node_type: 'trigger',
      kind: 'time_schedule',
      config: { cron, label: `Monthly on day ${dom} at ${formatTime(hour, minute)}` },
    };
  }

  if (scheduleByMonthDow) {
    const weeks = getElementText(scheduleByMonthDow, 'Weeks') ?? '1';
    const days = parseDaysOfWeek(getElementBlock(scheduleByMonthDow, 'DaysOfWeek'));
    const cron = cronFromTime(hour, minute, undefined, days);
    return {
      node_type: 'trigger',
      kind: 'time_schedule',
      config: {
        cron,
        label: `Monthly (week ${weeks}) ${days ? formatDays(days) : ''} at ${formatTime(hour, minute)}`.trim(),
      },
    };
  }

  if (scheduleByDay) {
    const interval = parseInt(getElementText(scheduleByDay, 'DaysInterval') ?? '1', 10);
    if (interval > 1) {
      return {
        node_type: 'trigger',
        kind: 'interval_trigger',
        config: { intervalMinutes: interval * 24 * 60, label: `Every ${interval} days (approx.)` },
      };
    }
    const cron = cronFromTime(hour, minute);
    return { node_type: 'trigger', kind: 'time_schedule', config: { cron, label: `Daily at ${formatTime(hour, minute)}` } };
  }

  if (start) {
    const cron = cronFromTime(hour, minute);
    return { node_type: 'trigger', kind: 'time_schedule', config: { cron, label: `Scheduled at ${formatTime(hour, minute)}` } };
  }
  return null;
}

function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatDays(days: number[]): string {
  return days.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(', ');
}

function mapTimeTrigger(triggerBlock: string): TaskSchedulerImportNode | null {
  const repetition = getElementBlock(triggerBlock, 'Repetition');
  const interval = repetition ? getElementText(repetition, 'Interval') : null;
  const minutes = parseIsoDurationMinutes(interval);
  if (minutes != null) {
    return {
      node_type: 'trigger',
      kind: 'interval_trigger',
      config: { intervalMinutes: minutes, label: `Every ${minutes} minute(s)` },
    };
  }
  const start = getElementText(triggerBlock, 'StartBoundary');
  const { hour, minute } = parseStartBoundaryTime(start);
  const cron = cronFromTime(hour, minute);
  return { node_type: 'trigger', kind: 'time_schedule', config: { cron, label: `At ${formatTime(hour, minute)}` } };
}

function mapTrigger(triggerBlock: string, warnings: string[]): TaskSchedulerImportNode | null {
  const tagMatch = triggerBlock.match(/^<(\w+)/);
  const tag = tagMatch?.[1] ?? '';
  if (!isTruthyXml(getElementText(triggerBlock, 'Enabled'))) return null;

  switch (tag) {
    case 'CalendarTrigger':
      return mapCalendarTrigger(triggerBlock);
    case 'TimeTrigger':
      return mapTimeTrigger(triggerBlock);
    case 'BootTrigger':
      return { node_type: 'trigger', kind: 'system_startup', config: { label: 'On system startup (imported boot trigger)' } };
    case 'LogonTrigger':
      return { node_type: 'trigger', kind: 'system_startup', config: { label: 'On Windows login' } };
    case 'IdleTrigger': {
      const seconds = parseInt(getElementText(triggerBlock, 'IdleDuration')?.replace(/\D/g, '') ?? '300', 10);
      return {
        node_type: 'trigger',
        kind: 'idle_trigger',
        config: { idleSeconds: Number.isFinite(seconds) ? seconds : 300, label: 'After idle (imported)' },
      };
    }
    case 'EventTrigger':
      warnings.push('Event-based trigger was not converted; using a daily 9:00 AM schedule placeholder.');
      return { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 9 * * *', label: 'Placeholder schedule (was event trigger)' } };
    case 'RegistrationTrigger':
    case 'SessionStateChangeTrigger':
      warnings.push(`${tag} was mapped to a system startup trigger.`);
      return { node_type: 'trigger', kind: 'system_startup', config: { label: `Imported from ${tag}` } };
    default:
      warnings.push(`Unsupported trigger type "${tag}" — using daily 9:00 AM placeholder.`);
      return { node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 9 * * *', label: 'Placeholder schedule' } };
  }
}

function splitCommandLine(command: string, argumentsText: string): { path: string; args: string } {
  const cmd = command.trim();
  const args = argumentsText.trim();
  const cmdLower = cmd.toLowerCase();
  if (cmdLower.endsWith('powershell.exe') || cmdLower.endsWith('pwsh.exe')) {
    const fileMatch = args.match(/(?:-File|-Command)\s+"([^"]+)"|(?:-File|-Command)\s+(\S+)/i);
    const scriptPath = fileMatch?.[1] ?? fileMatch?.[2];
    if (scriptPath) return { path: scriptPath, args: '' };
  }
  if (cmdLower.endsWith('cmd.exe') && /^\/?c\s+/i.test(args)) {
    const rest = args.replace(/^\/?c\s+/i, '').trim();
    const quoted = rest.match(/^"([^"]+)"/);
    if (quoted) return { path: quoted[1]!, args: '' };
    const first = rest.split(/\s+/)[0];
    if (first) return { path: first, args: rest.slice(first.length).trim() };
  }
  return { path: cmd, args };
}

function mapExecAction(actionBlock: string): TaskSchedulerImportNode {
  const command = getElementText(actionBlock, 'Command') ?? '';
  const argumentsText = getElementText(actionBlock, 'Arguments') ?? '';
  const workingDirectory = getElementText(actionBlock, 'WorkingDirectory') ?? '';
  const { path, args } = splitCommandLine(command, argumentsText);
  const ext = path.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  const labelBase = path.split(/[/\\]/).pop() ?? 'Imported action';

  if (ext === 'ps1') {
    return {
      node_type: 'action',
      kind: 'run_script',
      config: { path, shell: 'powershell', label: `Run ${labelBase}` },
    };
  }
  if (ext === 'bat' || ext === 'cmd' || ext === 'vbs') {
    return {
      node_type: 'action',
      kind: 'run_script',
      config: { path, shell: 'cmd', label: `Run ${labelBase}` },
    };
  }

  const config: Record<string, unknown> = { path, args, label: `Run ${labelBase}` };
  if (workingDirectory) config['workingDirectory'] = workingDirectory;
  return { node_type: 'action', kind: 'open_application', config };
}

function mapShowMessageAction(actionBlock: string): TaskSchedulerImportNode {
  const title = getElementText(actionBlock, 'Title') ?? 'TaskForge';
  const body = getElementText(actionBlock, 'Body') ?? 'Imported from Task Scheduler';
  return { node_type: 'action', kind: 'show_notification', config: { title, body, label: 'Show notification' } };
}

function mapSendEmailAction(actionBlock: string): TaskSchedulerImportNode {
  return {
    node_type: 'action',
    kind: 'send_email',
    config: {
      smtpHost: getElementText(actionBlock, 'SmtpServer') ?? '',
      smtpPort: parseInt(getElementText(actionBlock, 'Port') ?? '587', 10) || 587,
      smtpUser: '',
      smtpPass: '',
      from: getElementText(actionBlock, 'From') ?? '',
      to: getElementText(actionBlock, 'To') ?? '',
      subject: getElementText(actionBlock, 'Subject') ?? 'Imported task',
      body: getElementText(actionBlock, 'Body') ?? '',
      label: 'Send email (review SMTP settings)',
    },
  };
}

function mapAction(actionBlock: string, warnings: string[]): TaskSchedulerImportNode | null {
  const tagMatch = actionBlock.match(/^<(\w+)/);
  const tag = tagMatch?.[1] ?? '';
  switch (tag) {
    case 'Exec':
      return mapExecAction(actionBlock);
    case 'ShowMessage':
      return mapShowMessageAction(actionBlock);
    case 'SendEmail':
      return mapSendEmailAction(actionBlock);
    case 'ComHandler':
      warnings.push('COM handler action was replaced with a notification placeholder.');
      return {
        node_type: 'action',
        kind: 'show_notification',
        config: { title: 'TaskForge', body: 'Review imported COM handler action', label: 'Placeholder notification' },
      };
    default:
      warnings.push(`Unsupported action type "${tag}" was skipped.`);
      return null;
  }
}

/** Parse one `<Task>…</Task>` block into a TaskForge workflow draft. */
export function convertTaskSchedulerTaskBlock(taskXml: string): TaskSchedulerImportDraft | null {
  const warnings: string[] = [];
  const registration = getElementBlock(taskXml, 'RegistrationInfo');
  const uri = registration ? getElementText(registration, 'URI') : null;
  const description = registration ? getElementText(registration, 'Description') ?? '' : '';
  const name = taskNameFromUri(uri) ?? 'Imported scheduled task';

  const settings = getElementBlock(taskXml, 'Settings');
  const enabled = settings ? isTruthyXml(getElementText(settings, 'Enabled')) : true;

  const triggersBlock = getElementBlock(taskXml, 'Triggers');
  const triggerNodes: TaskSchedulerImportNode[] = [];
  if (triggersBlock) {
    const triggerBlocks = getAllElementBlocks(triggersBlock, 'CalendarTrigger')
      .concat(getAllElementBlocks(triggersBlock, 'TimeTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'BootTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'LogonTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'IdleTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'EventTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'RegistrationTrigger'))
      .concat(getAllElementBlocks(triggersBlock, 'SessionStateChangeTrigger'));
    for (const tb of triggerBlocks) {
      const mapped = mapTrigger(tb, warnings);
      if (mapped) triggerNodes.push(mapped);
    }
  }

  const actionsBlock = getElementBlock(taskXml, 'Actions');
  const actionNodes: TaskSchedulerImportNode[] = [];
  if (actionsBlock) {
    for (const tag of ['Exec', 'ShowMessage', 'SendEmail', 'ComHandler'] as const) {
      for (const ab of getAllElementBlocks(actionsBlock, tag)) {
        const mapped = mapAction(ab, warnings);
        if (mapped) actionNodes.push(mapped);
      }
    }
  }

  if (!triggerNodes.length && !actionNodes.length) return null;

  const nodes: TaskSchedulerImportNode[] = [];
  if (triggerNodes.length) {
    nodes.push(triggerNodes[0]!);
    if (triggerNodes.length > 1) {
      warnings.push(`Task had ${triggerNodes.length} triggers; only the first was imported.`);
    }
  } else {
    nodes.push({ node_type: 'trigger', kind: 'time_schedule', config: { cron: '0 9 * * *', label: 'Daily 9:00 AM (no trigger in import)' } });
    warnings.push('No supported trigger found; added a daily 9:00 AM placeholder.');
  }

  if (!actionNodes.length) {
    nodes.push({
      node_type: 'action',
      kind: 'show_notification',
      config: { title: 'TaskForge', body: `Imported task "${name}" had no supported actions.`, label: 'Placeholder notification' },
    });
    warnings.push('No supported actions found; added a placeholder notification.');
  } else {
    nodes.push(...actionNodes);
  }

  const descParts = [description.trim()];
  if (uri) descParts.push(`Task Scheduler path: ${uri}`);
  descParts.push('Imported from Windows Task Scheduler.');

  return {
    name: name.slice(0, 200),
    description: descParts.filter(Boolean).join('\n\n').slice(0, 4000),
    enabled,
    tags: ['imported', 'task-scheduler'],
    nodes,
    warnings,
  };
}

/** Parse Task Scheduler XML (single task or `<Tasks>` bundle) into workflow drafts. */
export function parseTaskSchedulerXml(xml: string): TaskSchedulerImportDraft[] {
  const trimmed = xml.trim();
  if (!trimmed) return [];
  const taskBlocks = getAllElementBlocks(trimmed, 'Task');
  if (!taskBlocks.length) return [];
  const drafts: TaskSchedulerImportDraft[] = [];
  for (const block of taskBlocks) {
    const draft = convertTaskSchedulerTaskBlock(block);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function uniqueWorkflowName(db: Database.Database, baseName: string): string {
  let name = baseName.slice(0, 200);
  const exists = db.prepare(`SELECT 1 FROM workflows WHERE name = ? LIMIT 1`);
  if (!exists.get(name)) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${baseName.slice(0, 190)} (${i})`.slice(0, 200);
    if (!exists.get(candidate)) return candidate;
  }
  return `${baseName.slice(0, 180)} (${randomUUID().slice(0, 8)})`;
}

function insertWorkflowDraft(db: Database.Database, draft: TaskSchedulerImportDraft): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const name = uniqueWorkflowName(db, draft.name);
  db.prepare(
    `INSERT INTO workflows (id, name, description, enabled, priority, tags, draft, run_count, created_at, updated_at, source_template_id, concurrency)
     VALUES (?, ?, ?, ?, 'normal', ?, 1, 0, ?, ?, NULL, 'allow')`
  ).run(id, name, draft.description, draft.enabled ? 1 : 0, JSON.stringify(draft.tags), now, now);

  const nodeIds: string[] = [];
  const insN = db.prepare(
    `INSERT INTO workflow_nodes (id, workflow_id, node_type, kind, config, position_x, position_y, sort_order) VALUES (?, ?, ?, ?, ?, 0, 0, ?)`
  );
  draft.nodes.forEach((n, idx) => {
    const nid = randomUUID();
    nodeIds.push(nid);
    insN.run(nid, id, n.node_type, n.kind, JSON.stringify(n.config), idx);
  });

  const insE = db.prepare(
    `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id) VALUES (?, ?, ?, ?)`
  );
  for (let i = 0; i < nodeIds.length - 1; i++) {
    insE.run(randomUUID(), id, nodeIds[i]!, nodeIds[i + 1]!);
  }
  return id;
}

/** Parse XML and insert workflows into SQLite (additive import; respects free-tier cap). */
export function importTaskSchedulerXmlIntoDb(db: Database.Database, xml: string): ImportTaskSchedulerResult {
  try {
    const drafts = parseTaskSchedulerXml(xml);
    if (!drafts.length) {
      return { ok: false, error: 'No Task Scheduler tasks found in the XML file.' };
    }

    const isPro = isProEnterpriseUnlocked(db);
    const existingCount = (db.prepare(`SELECT COUNT(*) as c FROM workflows`).get() as { c: number }).c;
    const maxNew = isPro ? drafts.length : Math.max(0, FREE_WORKFLOW_LIMIT - existingCount);

    const workflowIds: string[] = [];
    const warnings: string[] = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < drafts.length; i++) {
        if (i >= maxNew) break;
        const draft = drafts[i]!;
        workflowIds.push(insertWorkflowDraft(db, draft));
        warnings.push(...draft.warnings.map((w) => `${draft.name}: ${w}`));
      }
    });
    tx();

    const skipped = drafts.length - workflowIds.length;
    if (skipped > 0) {
      warnings.push(
        isPro
          ? `${skipped} task(s) were not imported due to an internal limit.`
          : `Free tier allows ${FREE_WORKFLOW_LIMIT} workflows; ${skipped} task(s) were skipped. Upgrade to Pro to import all.`
      );
    }

    return { ok: true, imported: workflowIds.length, skipped, workflowIds, warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function importTaskSchedulerXmlBuffer(db: Database.Database, buffer: Buffer): ImportTaskSchedulerResult {
  const xml = decodeTaskSchedulerXmlBuffer(buffer);
  return importTaskSchedulerXmlIntoDb(db, xml);
}
