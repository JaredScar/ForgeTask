import { spawn } from 'node:child_process';

export function runOpenFileOrFolder(config: Record<string, unknown>): Promise<void> {
  const target = String(config['path'] ?? '');
  if (!target) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', shell: false });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}
