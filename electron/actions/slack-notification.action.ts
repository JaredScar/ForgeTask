import { net } from 'electron';

/** Post a message to a Slack incoming webhook URL (Pro). */
export async function runSlackNotification(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = String(config['webhookUrl'] ?? '').trim();
  const text = String(config['text'] ?? '').trim();
  const username = String(config['username'] ?? 'TaskForge').trim();
  const iconEmoji = String(config['iconEmoji'] ?? ':robot_face:').trim();

  if (!webhookUrl) return { ok: false, error: 'Missing webhookUrl' };
  if (!text) return { ok: false, error: 'Missing message text' };

  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return { ok: false, error: 'Invalid webhookUrl' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'webhookUrl must use HTTPS' };

  const body = JSON.stringify({ text, username, icon_emoji: iconEmoji });

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const req = net.request({ method: 'POST', url: webhookUrl });
    req.setHeader('Content-Type', 'application/json');
    let respData = '';
    req.on('response', (resp) => {
      resp.on('data', (chunk: Buffer) => { respData += chunk.toString(); });
      resp.on('end', () => {
        if (resp.statusCode === 200 && respData.trim() === 'ok') {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `HTTP ${resp.statusCode}: ${respData.slice(0, 200)}` });
        }
      });
    });
    req.on('error', (e: Error) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}
