import { app, BrowserWindow, net, protocol, safeStorage, session, shell } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setDataRoot } from '../../core/src/config.js';
import { setSecretBox } from '../../core/src/secrets.js';
import { setClaudeExecutable, cancelClaudeLogin } from '../../core/src/claude-account.js';
import { loadLoginPath } from '../../core/src/login-env.js';
import { setSessionFetch } from '../../core/src/network.js';
import { applyProxy, registerIpc } from './ipc.js';
import { closeAllTerminals } from './terminal.js';
import { stopCopilot } from '../../core/src/copilot.js';

// Tokens sealed with the system keychain. Only touched when one is actually
// sealed or read (an ad-hoc signed app gets a keychain prompt on every update).
let keychainUsable: boolean | null = null;
const keychain = () => (keychainUsable ??= app.isReady() && safeStorage.isEncryptionAvailable());
setSecretBox({
  get available() {
    return keychain();
  },
  encrypt: (plain) => {
    if (!keychain()) throw new Error('The system keychain is not available');
    return safeStorage.encryptString(plain).toString('base64');
  },
  decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
});
void loadLoginPath();

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'renderer') : path.resolve(here, '../../web/out');

let mainWindow: BrowserWindow | null = null;

/**
 * The agent SDK's own `claude` binary, so the app never depends on (or
 * touches) a Claude Code the person installed. Packaged, it's unpacked next
 * to app.asar — a file inside the archive can be read but not run.
 */
function bundledClaude(): string | null {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    const resolved = createRequire(import.meta.url).resolve(`${pkg}/package.json`);
    const candidate = path.join(path.dirname(resolved), binary).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * The app was "AI Worker" before it was FJ AI Worker: its settings come
 * along to the new data folder. Sign-ins don't — the keychain keys them to
 * the old name and folder — so GitHub and Claude are signed in again.
 */
function carrySettingsOver(dataDir: string): void {
  const old = path.join(app.getPath('appData'), 'AI Worker', 'settings.json');
  const now = path.join(dataDir, 'settings.json');
  if (process.env.FJ_AI_WORKER_DATA_DIR || fs.existsSync(now) || !fs.existsSync(old)) return;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(old, now);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function isInsideRenderer(candidate: string): boolean {
  const rel = path.relative(RENDERER_DIR, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Each page's own inline scripts (Next's flight data) hashed; nothing else inline runs. */
function pageCsp(html: string): string {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    // GitHub avatars.
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function registerRendererProtocol(): void {
  protocol.handle('app', async (request) => {
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const candidates = path.extname(relative) ? [relative] : [`${relative}.html`, path.join(relative, 'index.html')];
    for (const candidate of candidates) {
      const full = path.join(RENDERER_DIR, candidate);
      if (!isInsideRenderer(full)) continue;
      const response = await net.fetch(pathToFileURL(full).toString());
      if (!response.ok) continue;
      if (!candidate.endsWith('.html')) return response;
      const html = await response.text();
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pageCsp(html) } });
    }
    return new Response('Not found', { status: 404 });
  });
}

function createWindow(): void {
  // Unpackaged, the dock would show Electron's own icon.
  const icon = path.resolve(here, '../build/icon.png');
  if (!app.isPackaged && process.platform === 'darwin' && fs.existsSync(icon)) app.dock?.setIcon(icon);
  mainWindow = new BrowserWindow({
    title: 'FJ AI Worker',
    width: 1200,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0c0b10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 17 } : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  mainWindow.loadURL('app://local/');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('app://')) {
      const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
      if (isInsideRenderer(path.join(RENDERER_DIR, pathname || 'index.html'))) return;
    }
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  mainWindow.on('closed', () => (mainWindow = null));
}

const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();
else
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  const dataDir = process.env.FJ_AI_WORKER_DATA_DIR || app.getPath('userData');
  carrySettingsOver(dataDir);
  setDataRoot(dataDir);
  setClaudeExecutable(bundledClaude());
  // Calls from the main process take the session's routing (the VPN tunnel
  // for GitHub, network.ts).
  setSessionFetch((url, init) => session.defaultSession.fetch(url, init));
  await applyProxy();
  registerRendererProtocol();
  registerIpc(() => mainWindow);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cancelClaudeLogin();
  void stopCopilot();
  closeAllTerminals();
});
