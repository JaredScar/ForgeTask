import { app, BrowserWindow, dialog, Menu, Tray, nativeImage, session, shell, type NativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabase } from './db/database';
import { AutomationEngine } from './engine/automation-engine';
import { TriggerManager } from './engine/trigger-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { startApiServer } from './api-server';
import { assertEntitlementBuildConfig, readStoredEntitlementKey } from './entitlement';
import { getLicenseApiUrl, getLicenseMode, refreshLicenseOnline } from './license-remote';
import { purgeOldLogs } from './db/log-retention';

const isDev = process.argv.includes('--dev');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiStop: (() => void) | null = null;
let isQuitting = false;
/** Held for graceful WAL checkpoint + close on quit (avoids “lost” data after abrupt dev restarts). */
let appDb: ReturnType<typeof openDatabase> | null = null;

/** Prefer `.ico` on Windows (Electron’s recommendation); keeps taskbar/window chrome reliable. */
function taskforgeIconFileNames(): string[] {
  return process.platform === 'win32' ? ['taskforge.ico', 'taskforge.png'] : ['taskforge.png', 'taskforge.ico'];
}

/** Transparent app logo — avoid `favicon.ico` in the page head or Chromium replaces the window icon. */
function resolveTaskforgeIconPath(): string | undefined {
  const roots = [
    path.join(__dirname, '..', 'public'),
    path.join(__dirname, '..'),
    path.join(app.getAppPath(), 'public'),
    app.getAppPath(),
    path.join(process.cwd(), 'public'),
    process.cwd(),
  ];
  for (const root of roots) {
    for (const name of taskforgeIconFileNames()) {
      const p = path.join(root, name);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

function loadWindowIcon(): NativeImage | undefined {
  const p = resolveTaskforgeIconPath();
  if (!p) return undefined;
  try {
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

/** Tray sizes are small; scale down on Windows while keeping PNG alpha. */
function loadTrayIcon(): NativeImage {
  const p = resolveTaskforgeIconPath();
  if (!p) return nativeImage.createEmpty();
  try {
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return nativeImage.createEmpty();
    if (process.platform === 'win32') {
      const { width } = img.getSize();
      if (width > 32) img = img.resize({ width: 32 });
    }
    return img;
  } catch {
    return nativeImage.createEmpty();
  }
}

function shutdownDatabase(): void {
  if (!appDb) return;
  const d = appDb;
  appDb = null;
  try {
    d.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.error('[taskforge] wal_checkpoint failed', e);
  }
  try {
    d.close();
  } catch (e) {
    console.error('[taskforge] database close failed', e);
  }
}

/** Origins the renderer itself is allowed to occupy. */
const ALLOWED_RENDERER_ORIGINS = new Set(isDev ? ['http://127.0.0.1:4200'] : []);

function isAllowedRendererTarget(rawUrl: string): boolean {
  // The packaged app runs from file://; the dev build runs from the Angular server.
  if (rawUrl.startsWith('file://')) return true;
  try {
    return ALLOWED_RENDERER_ORIGINS.has(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}

/**
 * Keeps the renderer pinned to app content. Without this, a link or injected
 * markup could navigate the window (which holds the full `window.taskForge`
 * IPC bridge) to an attacker-controlled page, or open a child window that
 * inherits it.
 */
function applyNavigationPolicy(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isAllowedRendererTarget(url)) return;
    event.preventDefault();
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
  });

  contents.on('will-attach-webview', (event) => {
    // The app never uses <webview>; attaching one would create an unaudited surface.
    event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    // External links open in the user's browser, never in a privileged window.
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      /* ignore malformed URLs */
    }
    return { action: 'deny' };
  });
}

/**
 * Defence-in-depth CSP for the renderer. The packaged app loads only local
 * assets, so remote script/frame sources are refused outright.
 */
function applyContentSecurityPolicy(): void {
  const connectSrc = isDev
    ? "'self' http://127.0.0.1:4200 ws://127.0.0.1:4200"
    : "'self'";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            // Angular's runtime styles require inline style attributes.
            "style-src 'self' 'unsafe-inline'",
            `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            `connect-src ${connectSrc}`,
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
        ],
      },
    });
  });
}

function createWindow(): void {
  const windowIcon = loadWindowIcon();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const reapplyWindowIcon = (): void => {
    if (windowIcon && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(windowIcon);
    }
  };
  /* Remote URL / SPA can adopt the document favicon and override the Windows taskbar icon — reset after load. */
  mainWindow.webContents.on('did-finish-load', reapplyWindowIcon);

  applyNavigationPolicy(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => {
    reapplyWindowIcon();
    mainWindow?.show();
  });

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:4200');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, '../dist/taskforge/browser/index.html');
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  const img = loadTrayIcon();
  if (img.isEmpty()) {
    console.error('[taskforge] taskforge.png not found — system tray disabled');
    return;
  }
  tray = new Tray(img);
  tray.setToolTip('TaskForge');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open TaskForge',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    } else {
      createWindow();
    }
  });
}

void app
  .whenReady()
  .then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('app.taskforge.desktop');
    }
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null);
    }

    let db: ReturnType<typeof openDatabase>;
    try {
      db = openDatabase();
      appDb = db;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dialog.showErrorBox(
        'TaskForge — database could not start',
        [
          'The SQLite native add-on (better-sqlite3) is not built for this Electron version.',
          '',
          'From the project folder run:',
          '  npm run rebuild:native',
          '',
          msg,
        ].join('\n')
      );
      app.quit();
      return;
    }

    try {
      const row = db.prepare(`SELECT value FROM settings WHERE key = 'clear_logs_on_startup'`).get() as { value: string } | undefined;
      if (row?.value === '1' || row?.value === 'true') {
        db.prepare(`DELETE FROM execution_logs`).run();
      }
    } catch (e) {
      console.error('[taskforge] clear_logs_on_startup failed', e);
    }

    purgeOldLogs(db);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    setInterval(() => purgeOldLogs(db), MS_PER_DAY);

    const engine = new AutomationEngine(
      db,
      (payload) => {
        mainWindow?.webContents.send('logs:new', payload);
      },
      (step) => {
        mainWindow?.webContents.send('logs:stepProgress', step);
      }
    );
    const triggers = new TriggerManager(db, engine);
    registerIpcHandlers(db, engine, triggers, () => mainWindow);
    apiStop = startApiServer(db, engine, triggers).stop;

    const licenseUrl = getLicenseApiUrl();
    const licenseMode = getLicenseMode();
    if (licenseUrl && licenseMode !== 'local' && readStoredEntitlementKey(db).trim()) {
      void refreshLicenseOnline(db).catch(() => undefined);
    }

    // Keep online entitlement fresh while the app is open.
    // This is intentionally "best effort": failures should not break UX because cached grace may keep users unlocked.
    if (licenseUrl && licenseMode !== 'local' && readStoredEntitlementKey(db).trim()) {
      const MS_PER_HOUR = 60 * 60 * 1000;
      const REFRESH_INTERVAL_MS = 24 * MS_PER_HOUR; // §20.9 guidance: 12–24h; pick 24h for reduced traffic.
      setInterval(() => {
        void refreshLicenseOnline(db).catch(() => undefined);
      }, REFRESH_INTERVAL_MS);
    }

    triggers.reloadFromDatabase();
    triggers.runStartupTriggers();

    assertEntitlementBuildConfig();
    applyContentSecurityPolicy();
    createWindow();
    createTray();

    if (app.isPackaged) {
      try {
        // Prefer the stable GitHub Release channel (not pre-releases).
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: process.env.TASKFORGE_UPDATE_GITHUB_OWNER ?? 'JaredScar',
          repo: process.env.TASKFORGE_UPDATE_GITHUB_REPO ?? 'TaskForge',
          releaseType: 'release',
        } as any);
      } catch {
        /* if provider misconfigured, fall back to defaults */
      }
      autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  })
  .catch((e) => {
    console.error(e);
    dialog.showErrorBox('TaskForge', e instanceof Error ? e.message : String(e));
    app.quit();
  });

app.on('window-all-closed', () => {
  /* keep running in tray on Windows */
});

app.on('before-quit', () => {
  isQuitting = true;
  apiStop?.();
  shutdownDatabase();
});

process.once('SIGINT', () => {
  void app.quit();
});
process.once('SIGTERM', () => {
  void app.quit();
});
