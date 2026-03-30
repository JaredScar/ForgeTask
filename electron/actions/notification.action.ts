import { Notification } from 'electron';

export function runShowNotification(config: Record<string, unknown>): void {
  const title = String(config['title'] ?? 'TaskForge');
  const body = String(config['body'] ?? 'Workflow notification');
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}
