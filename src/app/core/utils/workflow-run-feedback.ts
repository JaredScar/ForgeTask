import type { TaskForgeBridge } from '../../../types/taskforge-window';
import type { ToastService } from '../services/toast.service';

/** Reserved IPC return value when the browser mock “runs” a workflow (no real engine). */
export const MOCK_WORKFLOW_RUN_LOG_ID = '__tf_mock_run__';

export async function toastAfterManualWorkflowRun(
  api: TaskForgeBridge,
  logId: string,
  toast: ToastService
): Promise<void> {
  if (logId === MOCK_WORKFLOW_RUN_LOG_ID) {
    toast.success('Run finished (browser mock only — use Electron to execute for real).');
    return;
  }
  if (!logId) {
    toast.info('Run was queued because this workflow was already running.');
    return;
  }
  try {
    const { log } = await api.logs.get(logId);
    const status = String((log as Record<string, unknown> | null)?.['status'] ?? '');
    if (status === 'failure') {
      toast.warning('Workflow reported failure — open Logs to see which step failed.');
      return;
    }
    if (status === 'skipped') {
      toast.warning('Workflow was skipped (often a condition) — see Logs for details.');
      return;
    }
    toast.success('Workflow completed — see Logs for step details.');
  } catch {
    toast.success('Run finished — check Logs');
  }
}
