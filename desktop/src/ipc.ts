import { app, ipcMain, session, shell, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
import { connectJira, disconnectJira, getTicket, jiraState, listProjects, searchTickets, type TicketFilter } from '../../core/src/jira.js';
import {
  acceptTests,
  createRun,
  deleteRun,
  getRun,
  isRunning,
  listRuns,
  onRunChange,
  rerunAnalysis,
  retryFix,
  retryTests,
  reviewPlan,
  runChanges,
  runFileDiff,
  setMovedInProgress,
  setPlanInTicket,
  setTestCommand,
  stopRun,
  type NewRun,
  type Run,
} from '../../core/src/runs.js';
import { worktreeDir } from '../../core/src/repos.js';
import { closeTerminal, listTerminals, onTerminalEvent, openTerminal, resizeTerminal, terminalBuffer, writeTerminal, type TerminalKind } from './terminal.js';
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

/**
 * The VPN script's Edge: its own profile (~/.edge-vpn-proxy), going out
 * through the tunnel — where the company's GitHub and Google sign-ins live,
 * rather than the person's own browser. Mac only, like the script.
 */
const EDGE = '/Applications/Microsoft Edge.app';
const EDGE_PROFILE = path.join(os.homedir(), '.edge-vpn-proxy');

function vpnBrowserAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync(EDGE);
}

function openInVpnBrowser(url: string): Promise<void> {
  const { host, port } = getSettings().proxy;
  // Same arguments as the script, so an Edge it already opened takes the
  // link as a new tab instead of starting a second copy.
  const args = ['-na', 'Microsoft Edge', '--args', `--proxy-server=socks5://${host}:${port}`, `--user-data-dir=${EDGE_PROFILE}`, url];
  return new Promise((resolve, reject) =>
    execFile('open', args, (err, _o, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve())),
  );
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
    vpnBrowser: vpnBrowserAvailable(),
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
  handle(CHANNELS.githubAllRepos, () => listRepos(1000));

  // Runs (core/src/runs.ts): each change goes to the window whole, with
  // whether Claude is working on it now.
  const withLive = (r: Run) => ({ ...r, running: isRunning(r.id) });
  onRunChange((r) => send(CHANNELS.runsEvent, withLive(r)));
  handle(CHANNELS.runsList, () => listRuns().map(withLive));
  handle(CHANNELS.runsCreate, (input: NewRun) => withLive(createRun(input)));
  handle(CHANNELS.runsReview, (id: string, decision: Parameters<typeof reviewPlan>[1]) => withLive(reviewPlan(id, decision)));
  handle(CHANNELS.runsPlanInTicket, (id: string, done: boolean) => withLive(setPlanInTicket(id, done)));
  handle(CHANNELS.runsStop, (id: string) => withLive(stopRun(id)));
  handle(CHANNELS.runsRerun, (id: string) => withLive(rerunAnalysis(id)));
  handle(CHANNELS.runsDelete, async (id: string) => {
    await deleteRun(id);
    send(CHANNELS.runsEvent, { id, deleted: true });
  });
  handle(CHANNELS.runsMovedInProgress, (id: string, done: boolean) => withLive(setMovedInProgress(id, done)));
  handle(CHANNELS.runsTestCommand, (id: string, command: string) => withLive(setTestCommand(id, command)));
  handle(CHANNELS.runsRetryFix, (id: string) => withLive(retryFix(id)));
  handle(CHANNELS.runsRetryTests, (id: string) => withLive(retryTests(id)));
  handle(CHANNELS.runsAcceptTests, (id: string) => withLive(acceptTests(id)));
  handle(CHANNELS.runsChanges, (id: string) => runChanges(id));
  handle(CHANNELS.runsFileDiff, (id: string, file: string) => runFileDiff(id, file));
  // The run's checkout, in the Finder / Explorer or in VS Code.
  handle(CHANNELS.runsOpenFolder, async (id: string, how: 'folder' | 'vscode') => {
    const dir = worktreeDir(getRun(id).id);
    if (!fs.existsSync(dir)) throw new Error('The checkout isn’t there yet');
    if (how === 'vscode') {
      await new Promise<void>((resolve, reject) =>
        execFile(
          process.platform === 'darwin' ? 'open' : 'code',
          process.platform === 'darwin' ? ['-a', 'Visual Studio Code', dir] : [dir],
          { shell: process.platform === 'win32' },
          (err) => (err ? reject(new Error('VS Code isn’t installed (or not on PATH)')) : resolve()),
        ),
      );
    } else {
      const err = await shell.openPath(dir);
      if (err) throw new Error(err);
    }
  });

  // Terminals (terminal.ts).
  onTerminalEvent((ev) => send(CHANNELS.termEvent, ev));
  handle(CHANNELS.termList, () => listTerminals());
  handle(CHANNELS.termOpen, (kind: TerminalKind, cols?: number, rows?: number) => {
    if (kind !== 'shell' && kind !== 'vpn') throw new Error('Unknown terminal');
    return openTerminal(kind, cols, rows);
  });
  handle(CHANNELS.termBuffer, (id: string) => terminalBuffer(id));
  handle(CHANNELS.termClose, (id: string) => closeTerminal(id));
  ipcMain.on(CHANNELS.termWrite, (_e, id: string, data: string) => writeTerminal(id, data));
  ipcMain.on(CHANNELS.termResize, (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows));

  handle(CHANNELS.jiraState, () => jiraState());
  handle(CHANNELS.jiraConnect, (input: { site: string; email: string; token: string }) => connectJira(input));
  handle(CHANNELS.jiraDisconnect, () => disconnectJira());
  handle(CHANNELS.jiraProjects, () => listProjects());
  handle(CHANNELS.jiraSearch, (filter: TicketFilter) => searchTickets(filter));
  handle(CHANNELS.jiraTicket, (key: string) => getTicket(key));

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
  handle(CHANNELS.openInVpnBrowser, async (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('Only https links open');
    if (!vpnBrowserAvailable()) throw new Error('Microsoft Edge is not installed');
    await openInVpnBrowser(url);
  });
}
