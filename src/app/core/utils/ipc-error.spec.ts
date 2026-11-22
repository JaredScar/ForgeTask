import { describe, expect, it } from 'vitest';
import { TaskForgeIpcError, isTaskForgeIpcError, isTaskForgeIpcFailure } from './ipc-error';

describe('TaskForge IPC errors', () => {
  it('recognizes instances and preload-shaped failures', () => {
    const err = new TaskForgeIpcError('ENTITLEMENT_REQUIRED', 'ENTITLEMENT_REQUIRED');
    expect(isTaskForgeIpcError(err)).toBe(true);
    expect(err.code).toBe('ENTITLEMENT_REQUIRED');

    const shaped = Object.assign(new Error('nope'), { name: 'TaskForgeIpcError', code: 'WORKFLOW_LIMIT_REACHED' });
    expect(isTaskForgeIpcFailure(shaped)).toBe(true);
    expect(isTaskForgeIpcError(shaped)).toBe(false);
  });

  it('rejects unrelated values', () => {
    expect(isTaskForgeIpcError(new Error('x'))).toBe(false);
    expect(isTaskForgeIpcFailure({ name: 'TaskForgeIpcError' })).toBe(false);
    expect(isTaskForgeIpcFailure(null)).toBe(false);
  });
});
