import { describe, expect, it, vi } from 'vitest';
import { MOCK_WORKFLOW_RUN_LOG_ID, toastAfterManualWorkflowRun } from './workflow-run-feedback';

function toast() {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };
}

describe('toastAfterManualWorkflowRun', () => {
  it('explains the browser mock run', async () => {
    const t = toast();
    await toastAfterManualWorkflowRun({} as never, MOCK_WORKFLOW_RUN_LOG_ID, t as never);
    expect(t.success).toHaveBeenCalledOnce();
    expect(String(t.success.mock.calls[0]?.[0])).toMatch(/browser mock/i);
  });

  it('explains a queued run when there is no log id', async () => {
    const t = toast();
    await toastAfterManualWorkflowRun({} as never, '', t as never);
    expect(t.info).toHaveBeenCalledOnce();
    expect(String(t.info.mock.calls[0]?.[0])).toMatch(/queued/i);
  });

  it('warns when the finished log failed or was skipped', async () => {
    const t = toast();
    const api = { logs: { get: vi.fn().mockResolvedValue({ log: { status: 'failure' } }) } };
    await toastAfterManualWorkflowRun(api as never, 'log-1', t as never);
    expect(t.warning).toHaveBeenCalledOnce();

    api.logs.get.mockResolvedValue({ log: { status: 'skipped' } });
    await toastAfterManualWorkflowRun(api as never, 'log-1', t as never);
    expect(t.warning).toHaveBeenCalledTimes(2);
  });

  it('confirms a successful log and still confirms when the log lookup fails', async () => {
    const t = toast();
    const api = { logs: { get: vi.fn().mockResolvedValue({ log: { status: 'success' } }) } };
    await toastAfterManualWorkflowRun(api as never, 'log-1', t as never);
    expect(t.success).toHaveBeenCalledOnce();

    api.logs.get.mockRejectedValue(new Error('offline'));
    await toastAfterManualWorkflowRun(api as never, 'log-1', t as never);
    expect(t.success).toHaveBeenCalledTimes(2);
    expect(String(t.success.mock.calls[1]?.[0])).toMatch(/check Logs/i);
  });
});
