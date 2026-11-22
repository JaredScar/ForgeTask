import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultActionConfig, defaultConditionConfig, defaultTriggerConfig, stubTimeTriggerConfig } from './catalog-starters';

const TRIGGERS = [
  'time_schedule',
  'system_startup',
  'interval_trigger',
  'power_event',
  'app_launch',
  'network_change',
  'file_change',
  'cpu_memory_usage',
  'device_connected',
  'idle_trigger',
  'memory_trigger',
  'device_trigger',
  'webhook_trigger',
  'process_exit',
  'window_focus',
  'display_change',
  'clipboard_monitor',
];

const CONDITIONS = ['wifi_network', 'time_window', 'app_running', 'branch_if'];

const ACTIONS = [
  'open_application',
  'show_notification',
  'open_file_folder',
  'dark_mode_toggle',
  'audio_control',
  'run_script',
  'http_request',
  'zip_archive',
  'download_file',
  'wake_on_lan',
  'tcp_port_check',
  'screenshot_save',
  'kill_process',
  'file_operation',
  'open_url',
  'clipboard_write',
  'write_text_file',
  'lock_workstation',
  'delay_wait',
  'send_email',
  'slack_notification',
  'set_variable',
  'input_simulation',
];

void test('every catalog trigger, condition, and action has a labeled starter config', () => {
  for (const kind of TRIGGERS) {
    const config = defaultTriggerConfig(kind);
    assert.equal(typeof config['label'], 'string', kind);
    assert.notEqual(config['label'], kind, `${kind} should not fall through to the generic label`);
  }
  for (const kind of CONDITIONS) {
    const config = defaultConditionConfig(kind);
    assert.equal(typeof config['label'], 'string', kind);
    assert.notEqual(config['label'], kind);
  }
  for (const kind of ACTIONS) {
    const config = defaultActionConfig(kind);
    assert.equal(typeof config['label'], 'string', kind);
    assert.notEqual(config['label'], kind);
  }
});

void test('schedule and branch starters are runnable shapes', () => {
  assert.equal(defaultTriggerConfig('time_schedule')['cron'], '0 9 * * *');
  assert.equal(defaultConditionConfig('branch_if')['checkKind'], 'variable_truthy');
  assert.equal(defaultActionConfig('http_request')['method'], 'GET');
  assert.equal(stubTimeTriggerConfig()['cron'], '0 9 * * *');
});
