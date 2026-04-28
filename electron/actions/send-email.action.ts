import * as net from 'node:net';

export interface SendEmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  secure?: boolean;
}

/** Send email via SMTP using a minimal raw TCP implementation (no external packages required). */
export async function runSendEmail(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const host = String(config['smtpHost'] ?? '').trim();
  const port = Number(config['smtpPort'] ?? 587);
  const user = String(config['smtpUser'] ?? '').trim();
  const pass = String(config['smtpPass'] ?? '');
  const from = String(config['from'] ?? user).trim();
  const to = String(config['to'] ?? '').trim();
  const subject = String(config['subject'] ?? '(no subject)');
  const body = String(config['body'] ?? '');

  if (!host || !to) return { ok: false, error: 'Missing smtpHost or to address' };

  const creds = Buffer.from(`\0${user}\0${pass}`).toString('base64');
  const date = new Date().toUTCString();
  const msgId = `<tf-${Date.now()}@taskforge>`;
  const message = [
    `Date: ${date}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${msgId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
    `.`,
  ].join('\r\n');

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const sock = net.createConnection(port, host);
    let buf = '';
    let step = 0;

    const send = (line: string): void => { sock.write(line + '\r\n'); };

    const advance = (): void => {
      step++;
      switch (step) {
        case 1: send(`EHLO taskforge`); break;
        case 2: send(`AUTH PLAIN ${creds}`); break;
        case 3: send(`MAIL FROM:<${from}>`); break;
        case 4: send(`RCPT TO:<${to}>`); break;
        case 5: send(`DATA`); break;
        case 6: send(message); break;
        case 7: send(`QUIT`); break;
        default: sock.destroy(); resolve({ ok: true }); break;
      }
    };

    sock.setTimeout(15_000);
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        if (step === 0 && code === 220) { advance(); return; }
        if (code >= 400) { sock.destroy(); resolve({ ok: false, error: line }); return; }
        if (code === 250 || code === 235 || code === 354) advance();
        if (code === 221) { sock.destroy(); resolve({ ok: true }); return; }
      }
    });
    sock.on('error', (e) => resolve({ ok: false, error: e.message }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, error: 'SMTP timeout' }); });
  });
}
