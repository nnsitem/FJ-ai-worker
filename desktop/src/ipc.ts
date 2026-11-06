import { app, ipcMain, session, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import CHANNELS from './channels.json' with { type: 'json' };
import { getSettings, saveSettings, type SettingsPatch } from '../../core/src/settings.js';
import { pacScript, vpnStatus } from '../../core/src/network.js';
import {
  cancelDeviceFlow,
  finishDeviceFlow,
  githubState,
  listRepos,
  signOutGithub,
  startDeviceFlow,
  tokenFromGh,
  useToken,
} from '../../core/src/github.js';
import {
  cancelClaudeLogin,
  claudeAccount,
  claudeConfigDir,
  claudeLogout,
  startClaudeLogin,
  submitClaudeCode,
} from '../../core/src/claude-account.js';
import { openClaudeLoginWindow } from './claude-login-window.js';

export { CHANNELS };

/** Every reply as {ok, value} or {ok: false, error} — a thrown error loses its message on the way. */
type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) } satisfies Reply<T>;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Reply<T>;
    }
  });
}

/** The VPN routing (network.ts) on the app's session. */
export async function applyProxy(): Promise<void> {
  const pac = `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pacScript()).toString('base64')}`;
  await session.defaultSession.setProxy({ mode: 'pac_script', pacScript: pac });
  await session.defaultSession.closeAllConnections();
}

export function registerIpc(win: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  handle(CHANNELS.appInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    claudeConfigDir: claudeConfigDir(),
  }));

  handle(CHANNELS.settingsGet, () => getSettings());
  handle(CHANNELS.settingsSave, async (patch: SettingsPatch) => {
    const s = saveSettings(patch);
    if (patch.proxy) await applyProxy();
    return s;
  });

  handle(CHANNELS.vpnStatus, () => vpnStatus());
  handle(CHANNELS.vpnOpenScript, async () => {
    const script = getSettings().vpnScript;
    if (!script || !fs.existsSync(script)) throw new Error('Set the VPN script in Settings first');
    const err = await shell.openPath(script);
    if (err) throw new Error(err);
  });

  handle(CHANNELS.githubState, () => githubState());
  handle(CHANNELS.githubDeviceStart, () => startDeviceFlow());
  handle(CHANNELS.githubDeviceFinish, () => finishDeviceFlow());
  handle(CHANNELS.githubDeviceCancel, () => cancelDeviceFlow());
  handle(CHANNELS.githubUseToken, (token: string) => useToken(token));
  handle(CHANNELS.githubFromGh, async () => useToken(await tokenFromGh()));
  handle(CHANNELS.githubSignOut, () => signOutGithub());
  handle(CHANNELS.githubRepos, () => listRepos());

  handle(CHANNELS.claudeAccount, () => claudeAccount());
  // Starts `claude auth login`. In the app's own window (inWindow), the code
  // comes back by itself; otherwise the person opens the link in a browser of
  // their choosing and pastes the code (claudeSubmitCode).
  handle(CHANNELS.claudeLogin, async (inWindow: boolean) => {
    const { url } = await startClaudeLogin();
    if (inWindow) {
      void openClaudeLoginWindow(url, win()).then(async (code) => {
        if (!code) return send(CHANNELS.claudeLoginEvent, { kind: 'closed' });
        try {
          send(CHANNELS.claudeLoginEvent, { kind: 'done', account: await submitClaudeCode(code) });
        } catch (e) {
          send(CHANNELS.claudeLoginEvent, { kind: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      });
    }
    return { url };
  });
  handle(CHANNELS.claudeSubmitCode, (code: string) => submitClaudeCode(code));
  handle(CHANNELS.claudeCancelLogin, () => cancelClaudeLogin());
  handle(CHANNELS.claudeLogout, () => claudeLogout());

  handle(CHANNELS.openExternal, async (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only https links open');
    await shell.openExternal(url);
  });
}
