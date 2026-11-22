import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeActionNode, clipboardText, killProcessCommand, openUrlTarget } from '../engine/action-executor';
import { inputSimulationPlan } from './input-simulation';
import { buildWakeOnLanPacket, runDownloadFile, screenshotCaptureSize } from './pro-actions';
import { runSendEmail } from './send-email.action';
import { slackNotificationRequest } from './slack-notification.action';
import type { WorkflowNodeRow } from '../types';

function action(kind: string, config: unknown): WorkflowNodeRow {
  return {
    id: 'a1',
    workflow_id: 'w1',
    node_type: 'action',
    kind,
    config: JSON.stringify(config),
    position_x: 0,
    position_y: 0,
    sort_order: 0,
  };
}

void test('kill, open-url, and clipboard plans describe the action without performing it', () => {
  assert.deepEqual(killProcessCommand({}), { ok: false, error: 'Set processName or pid in config' });
  assert.deepEqual(killProcessCommand({ processName: ' notepad.exe ' }), {
    ok: true,
    file: 'taskkill',
    args: ['/IM', 'notepad.exe', '/F'],
  });
  assert.deepEqual(killProcessCommand({ pid: 42 }), { ok: true, file: 'taskkill', args: ['/PID', '42', '/F'] });

  assert.equal(openUrlTarget('https://example.com/a').ok, true);
  assert.equal(openUrlTarget('file:///C:/secret').ok, false);
  assert.equal(openUrlTarget('not a url').ok, false);
  assert.equal(clipboardText({ text: 'copied' }), 'copied');
  assert.equal(clipboardText({}), '');
});

void test('keyboard and mouse plans encode the input and do not send it', () => {
  const keys = inputSimulationPlan({ mode: 'keyboard', text: 'hello{ENTER}' }, 'win32');
  assert.equal(keys.ok, true);
  if (keys.ok) {
    assert.match(keys.script, /SendKeys/);
    assert.match(keys.script, /FromBase64String/);
    assert.equal(keys.script.includes('hello{ENTER}'), false);
  }
  assert.match(inputSimulationPlan({ mode: 'keyboard', text: '  ' }, 'win32').ok ? '' : 'empty', /empty/);
  const click = inputSimulationPlan({ mode: 'click', x: 12, y: 34, button: 'right' }, 'win32');
  assert.equal(click.ok, true);
  if (click.ok) {
    assert.match(click.script, /SetCursorPos\(12, 34\)/);
    assert.match(click.script, /RIGHTDOWN/);
    assert.match(click.script, /RIGHTUP/);
  }
  assert.equal(inputSimulationPlan({ mode: 'click', x: 'nope', y: 1 }, 'win32').ok, false);
  assert.match(inputSimulationPlan({ text: 'hi' }, 'linux').ok ? '' : 'Windows', /Windows/);
});

void test('wake-on-lan builds a magic packet and screenshot size stays inside the capture limits', () => {
  const packet = buildWakeOnLanPacket('AA:BB:CC:DD:EE:FF');
  assert.equal(packet.length, 102);
  assert.ok(packet.subarray(0, 6).every((b) => b === 0xff));
  assert.equal(packet.subarray(6, 12).toString('hex'), 'aabbccddeeff');
  assert.equal(packet.subarray(96, 102).toString('hex'), 'aabbccddeeff');
  assert.throws(() => buildWakeOnLanPacket('nope'), /MAC/);
  assert.deepEqual(screenshotCaptureSize({}), { width: 1920, height: 1080 });
  assert.deepEqual(screenshotCaptureSize({ width: 10, height: 9000 }), { width: 640, height: 4320 });
});

void test('slack requests require https, a url, and message text', () => {
  assert.equal(slackNotificationRequest({}).ok, false);
  assert.equal(slackNotificationRequest({ webhookUrl: 'https://hooks.slack.com/a', text: '  ' }).ok, false);
  assert.equal(slackNotificationRequest({ webhookUrl: 'http://hooks.slack.com/a', text: 'hi' }).ok, false);
  assert.equal(slackNotificationRequest({ webhookUrl: 'not-a-url', text: 'hi' }).ok, false);
  const built = slackNotificationRequest({
    webhookUrl: 'https://hooks.slack.com/services/T/B/x',
    text: 'done',
    username: 'Forge',
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.url, 'https://hooks.slack.com/services/T/B/x');
    assert.deepEqual(JSON.parse(built.body), { text: 'done', username: 'Forge', icon_emoji: ':robot_face:' });
  }
});

void test('send email completes against a local SMTP server', async () => {
  const received: string[] = [];
  const server = net.createServer((sock) => {
    let dataMode = false;
    sock.write('220 ready\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString();
      received.push(text);
      if (dataMode) {
        if (text.includes('\r\n.\r\n')) {
          dataMode = false;
          sock.write('250 queued\r\n');
        }
        return;
      }
      if (text.startsWith('DATA')) {
        dataMode = true;
        sock.write('354 go\r\n');
        return;
      }
      if (text.startsWith('QUIT')) {
        sock.write('221 bye\r\n');
        sock.end();
        return;
      }
      sock.write('250 ok\r\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const result = await runSendEmail({
      smtpHost: '127.0.0.1',
      smtpPort: port,
      smtpUser: 'ada',
      smtpPass: 'secret',
      from: 'ada@example.com',
      to: 'grace@example.com',
      subject: 'TaskForge hello',
      body: 'shipped',
    });
    assert.deepEqual(result, { ok: true });
    const transcript = received.join('');
    assert.match(transcript, /EHLO taskforge/);
    assert.match(transcript, /MAIL FROM:<ada@example.com>/);
    assert.match(transcript, /RCPT TO:<grace@example.com>/);
    assert.match(transcript, /Subject: TaskForge hello/);
    assert.match(transcript, /shipped/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

void test('download follows a local redirect and rename moves a file', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('payload');
      return;
    }
    res.writeHead(302, { Location: '/file' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskforge-rest-'));
  try {
    const dest = path.join(dir, 'saved.txt');
    const downloaded = await runDownloadFile({
      url: `http://127.0.0.1:${port}/start`,
      destinationPath: dest,
      allowPrivateNetwork: true,
    });
    assert.equal(downloaded.ok, true);
    assert.equal(downloaded.bytes, 7);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'payload');

    const source = path.join(dir, 'old.txt');
    const renamed = path.join(dir, 'new.txt');
    fs.writeFileSync(source, 'move-me');
    const result = await executeActionNode(
      action('file_operation', { operation: 'rename', source, destination: renamed, label: 'Rename' })
    );
    assert.equal(result.status, 'success');
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(renamed, 'utf8'), 'move-me');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
