import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';

type SaveResult = { canceled?: boolean; filePath?: string };
type OpenResult = { canceled?: boolean; filePaths?: string[] };

let saveOverride: ((opts: SaveDialogOptions) => Promise<SaveResult>) | null = null;
let openOverride: ((opts: OpenDialogOptions) => Promise<OpenResult>) | null = null;

/** Test seam so save/open flows can run without a native file dialog. */
export function setNativeDialogOverridesForTests(
  next: {
    save?: (opts: SaveDialogOptions) => Promise<SaveResult>;
    open?: (opts: OpenDialogOptions) => Promise<OpenResult>;
  } | null
): void {
  saveOverride = next?.save ?? null;
  openOverride = next?.open ?? null;
}

export async function pickSavePath(win: BrowserWindow | null, opts: SaveDialogOptions): Promise<string | null> {
  const result = saveOverride
    ? await saveOverride(opts)
    : dialog?.showSaveDialog
      ? win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      : { canceled: true as const };
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

export async function pickOpenPath(win: BrowserWindow | null, opts: OpenDialogOptions): Promise<string | null> {
  const result = openOverride
    ? await openOverride(opts)
    : dialog?.showOpenDialog
      ? win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      : { canceled: true as const, filePaths: [] as string[] };
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0] ?? null;
}
