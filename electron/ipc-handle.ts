import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { EntitlementRequiredError, WorkflowLimitError } from './entitlement';
import { IPC_ERROR_FLAG, type IpcErrorEnvelope } from './ipc-error-envelope';

export { IPC_ERROR_FLAG, type IpcErrorEnvelope, isIpcErrorEnvelope } from './ipc-error-envelope';

type RegisteredHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

const registeredHandlers = new Map<string, RegisteredHandler>();

/** Channels registered through `ipcHandle`, including when Electron's ipcMain is unavailable. */
export function registeredIpcChannels(): string[] {
  return [...registeredHandlers.keys()];
}

/** Calls a registered handler the same way the renderer invoke path does. */
export function invokeRegisteredIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`IPC channel not registered: ${channel}`);
  }
  return handler({} as IpcMainInvokeEvent, ...args) as Promise<T>;
}

/** Wraps invoke handlers so thrown errors become a structured envelope (never crashes the channel). */
export function ipcHandle<TArgs extends unknown[], TRet>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TRet | Promise<TRet>
): void {
  const wrapped: RegisteredHandler = async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      return await handler(event, ...(args as TArgs));
    } catch (e) {
      if (e instanceof EntitlementRequiredError) {
        return { [IPC_ERROR_FLAG]: true, code: e.code, message: e.message } satisfies IpcErrorEnvelope;
      }
      if (e instanceof WorkflowLimitError) {
        return { [IPC_ERROR_FLAG]: true, code: e.code, message: e.message } satisfies IpcErrorEnvelope;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ipc ${channel}]`, e);
      return { [IPC_ERROR_FLAG]: true, code: 'INTERNAL', message: msg } satisfies IpcErrorEnvelope;
    }
  };
  registeredHandlers.set(channel, wrapped);
  if (typeof ipcMain?.handle === 'function') {
    ipcMain.handle(channel, wrapped);
  }
}
