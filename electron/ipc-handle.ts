import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { EntitlementRequiredError } from './entitlement';

/** Preload/renderer detects this shape and throws `IpcCallError`. */
export const IPC_ERROR_FLAG = '__tfIpcErr' as const;

export type IpcErrorEnvelope = { [IPC_ERROR_FLAG]: true; code: string; message: string };

export function isIpcErrorEnvelope(v: unknown): v is IpcErrorEnvelope {
  return typeof v === 'object' && v !== null && IPC_ERROR_FLAG in v && (v as IpcErrorEnvelope)[IPC_ERROR_FLAG] === true;
}

/** Wraps invoke handlers so thrown errors become a structured envelope (never crashes the channel). */
export function ipcHandle<TArgs extends unknown[], TRet>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TRet | Promise<TRet>
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await handler(event, ...(args as TArgs));
    } catch (e) {
      if (e instanceof EntitlementRequiredError) {
        return { [IPC_ERROR_FLAG]: true, code: e.code, message: e.message } satisfies IpcErrorEnvelope;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ipc ${channel}]`, e);
      return { [IPC_ERROR_FLAG]: true, code: 'INTERNAL', message: msg } satisfies IpcErrorEnvelope;
    }
  });
}
