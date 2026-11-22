import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateConfigString, loadVariableMap } from './variable-interpolation';

void test('interpolateConfigString replaces variables and leaves unknown tokens', () => {
  const out = interpolateConfigString('open {{app}} at {{missing}}', { app: 'notepad.exe' });
  assert.equal(out, 'open notepad.exe at {{missing}}');
});

void test('interpolateConfigString prefers context tokens and does not treat them as variables', () => {
  const out = interpolateConfigString('hi {{context.user}} / {{user}}', { user: 'var-user' }, { user: 'ctx-user' });
  assert.equal(out, 'hi ctx-user / var-user');
});

void test('interpolateConfigString leaves unknown context tokens unchanged', () => {
  const out = interpolateConfigString('{{context.missing}}', { missing: 'nope' }, {});
  assert.equal(out, '{{context.missing}}');
});

void test('loadVariableMap reads plaintext variable rows', () => {
  const db = {
    prepare() {
      return {
        all() {
          return [
            { name: 'BACKUP_PATH', value: 'C:\\backups' },
            { name: '', value: 'ignored' },
          ];
        },
      };
    },
  };
  assert.deepEqual(loadVariableMap(db as never), { BACKUP_PATH: 'C:\\backups' });
});
