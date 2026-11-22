import { Notification } from 'electron';

export function notificationContent(config: Record<string, unknown>): { title: string; body: string } {
  return {
    title: String(config['title'] ?? 'TaskForge'),
    body: String(config['body'] ?? 'Workflow notification'),
  };
}

export function runShowNotification(config: Record<string, unknown>): void {
  const { title, body } = notificationContent(config);
  if (!Notification.isSupported()) {
    throw new Error(
      'Desktop notifications are not available (enable system notifications or use a packaged install with App User Model ID on Windows).'
    );
  }
  new Notification({ title, body }).show();
}
