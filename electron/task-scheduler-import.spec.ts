import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertTaskSchedulerTaskBlock,
  decodeTaskSchedulerXmlBuffer,
  parseTaskSchedulerXml,
} from './task-scheduler-import';

const SAMPLE_DAILY = `<?xml version="1.0" encoding="UTF-16"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Nightly backup job</Description>
    <URI>\\MyTasks\\Nightly Backup</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2025-06-01T02:30:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Settings>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Scripts\\backup.ps1</Command>
    </Exec>
  </Actions>
</Task>`;

const SAMPLE_LOGON_EXE = `<?xml version="1.0" encoding="UTF-8"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\Startup\\Open Notes</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Settings>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\\Windows\\System32\\notepad.exe</Command>
      <Arguments>readme.txt</Arguments>
    </Exec>
  </Actions>
</Task>`;

const SAMPLE_WEEKLY = `<?xml version="1.0" encoding="UTF-8"?>
<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\Reports\\Weekly Report</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2025-01-01T09:00:00</StartBoundary>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Monday />
          <Friday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Settings><Enabled>true</Enabled></Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-ExecutionPolicy Bypass -File "C:\\Reports\\run.ps1"</Arguments>
    </Exec>
  </Actions>
</Task>`;

void test('parseTaskSchedulerXml maps daily calendar trigger and ps1 action', () => {
  const drafts = parseTaskSchedulerXml(SAMPLE_DAILY);
  assert.equal(drafts.length, 1);
  const d = drafts[0]!;
  assert.equal(d.name, 'Nightly Backup');
  assert.equal(d.enabled, true);
  assert.equal(d.nodes[0]?.kind, 'time_schedule');
  assert.equal((d.nodes[0]?.config as { cron: string }).cron, '30 2 * * *');
  assert.equal(d.nodes[1]?.kind, 'run_script');
  assert.equal((d.nodes[1]?.config as { path: string }).path, 'C:\\Scripts\\backup.ps1');
});

void test('parseTaskSchedulerXml maps logon trigger to open_application', () => {
  const drafts = parseTaskSchedulerXml(SAMPLE_LOGON_EXE);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.nodes[0]?.kind, 'system_startup');
  assert.equal(drafts[0]!.nodes[1]?.kind, 'open_application');
  assert.equal((drafts[0]!.nodes[1]?.config as { path: string }).path, 'C:\\Windows\\System32\\notepad.exe');
});

void test('parseTaskSchedulerXml maps weekly schedule and powershell -File', () => {
  const drafts = parseTaskSchedulerXml(SAMPLE_WEEKLY);
  assert.equal(drafts.length, 1);
  assert.equal((drafts[0]!.nodes[0]?.config as { cron: string }).cron, '0 9 * * 1,5');
  assert.equal((drafts[0]!.nodes[1]?.config as { path: string }).path, 'C:\\Reports\\run.ps1');
});

void test('decodeTaskSchedulerXmlBuffer handles UTF-16 LE BOM', () => {
  const buf = Buffer.from([0xff, 0xfe, ...Buffer.from('<Task></Task>', 'utf16le')]);
  const xml = decodeTaskSchedulerXmlBuffer(buf);
  assert.match(xml, /<Task>/);
});

void test('convertTaskSchedulerTaskBlock returns null for empty task', () => {
  assert.equal(convertTaskSchedulerTaskBlock('<Task></Task>'), null);
});
