import { app } from 'electron';

/**
 * Packaged-build detection that is safe to import from unit tests.
 *
 * Outside the Electron runtime the `electron` module resolves to the executable
 * path string, so `app` is undefined rather than an App instance — hence the
 * defensive access instead of reading `app.isPackaged` directly.
 */
export function isPackagedBuild(): boolean {
  const maybeApp = app as typeof app | undefined;
  return maybeApp?.isPackaged === true;
}
