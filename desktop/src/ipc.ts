import { app, dialog, ipcMain, session, shell, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import CHANNELS from './channels.json' with { type: 'json' };
import { getSettings, saveSettings, type SettingsPatch } from '../../core/src/settings.js';
import { pacScript, vpnDisconnect, vpnStatus } from '../../core/src/network.js';
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
  sendMessage,
  approvePush,
  setMovedToReview,
  checkPullRequest,
  fixReview,
  finishReview,
  deleteTaskBranch,
  setCheckCommand,
  fixSelfReview,
  retrySelfReview,
  acceptSelfReview,
  watchPullRequests,
  setTaskOptions,
  setTaskPlace,
  setTicket,
  startWorkflow,
  workDir,
  setMovedInProgress,
  setPlanInTicket,
  setTestCommand,
  stopRun,
  type NewRun,
  type Run,
} from '../../core/src/runs.js';
import { aiOfficeLibrary, createLibraryItem, importLibrary, libraryItem, readLibrary, removeFromLibrary, saveLibraryItem, skillFile, skillFiles } from '../../core/src/library.js';
import { closeTerminal, listTerminals, onTerminalEvent, openTerminal, resizeTerminal, terminalBuffer, writeTerminal, type TerminalKind } from './terminal.js';
import { artifactContent, artifactFile, deleteArtifact, listArtifacts } from '../../core/src/artifacts.js';
import { deleteProjectContext, listProjectContexts, PROJECT_CONTEXT_TEMPLATE, saveProjectContext, taskProject } from '../../core/src/project-context.js';
import { getSettings as readSettings } from '../../core/src/settings.js';
import { cancelCopilotLogin, copilotAccount, copilotModels, copilotSignOut, setCopilotToken, startCopilotLogin, stopCopilot } from '../../core/src/copilot.js';
import { githubToken } from '../../core/src/github.js';
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
  handle(CHANNELS.vpnDisconnect, () => vpnDisconnect());
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
  handle(CHANNELS.runsSend, (id: string, text: string) => withLive(sendMessage(id, text)));
  handle(CHANNELS.runsStartWorkflow, (id: string) => withLive(startWorkflow(id)));
  handle(CHANNELS.runsSetOptions, (id: string, opts: { agent?: string | null; model?: string | null; engine?: 'claude' | 'copilot' }) => withLive(setTaskOptions(id, opts)));

  // The agents and skills library (core/src/library.ts): imported from AI
  // Office's, or from a folder the person picks.
  handle(CHANNELS.libraryList, () => readLibrary());
  handle(CHANNELS.libraryImport, async (from: 'aiOffice' | 'pick') => {
    let dir: string | null = from === 'aiOffice' ? aiOfficeLibrary() : null;
    if (from === 'pick') {
      const w = win();
      const opts = { title: 'Import agents and skills', properties: ['openDirectory' as const] };
      const picked = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      if (picked.canceled) return null;
      dir = picked.filePaths[0] ?? null;
    }
    if (!dir) throw new Error('AI Office’s library isn’t on this computer');
    return importLibrary(dir);
  });
  handle(CHANNELS.libraryRemove, (kind: 'agent' | 'skill', name: string) => removeFromLibrary(kind, name));
  handle(CHANNELS.libraryItem, (kind: 'agent' | 'skill', name: string) => libraryItem(kind, name));
  handle(CHANNELS.libraryCreate, (kind: 'agent' | 'skill', name: string, description: string) => {
    createLibraryItem(kind, name, description);
  });
  handle(CHANNELS.librarySave, (kind: 'agent' | 'skill', name: string, text: string) => saveLibraryItem(kind, name, text));
  handle(CHANNELS.librarySkillFiles, (name: string) => skillFiles(name));
  handle(CHANNELS.librarySkillFile, (name: string, rel: string) => skillFile(name, rel));
  handle(CHANNELS.libraryReveal, (kind: 'agent' | 'skill', name: string) => shell.showItemInFolder(libraryItem(kind, name).path));
  handle(CHANNELS.runsSetPlace, (id: string, place: { repo?: string; folder?: string; base?: string }) => withLive(setTaskPlace(id, place)));
  // Steps 6–7. There is no merge: a person merges on GitHub.
  handle(CHANNELS.runsApprovePush, (id: string) => withLive(approvePush(id)));
  handle(CHANNELS.runsMovedToReview, (id: string, done: boolean) => withLive(setMovedToReview(id, done)));
  handle(CHANNELS.runsCheckPr, async (id: string) => withLive(await checkPullRequest(id)));
  handle(CHANNELS.runsFixReview, (id: string) => withLive(fixReview(id)));
  handle(CHANNELS.runsFinishReview, (id: string) => withLive(finishReview(id)));
  handle(CHANNELS.runsCheckCommand, (id: string, command: string) => withLive(setCheckCommand(id, command)));
  handle(CHANNELS.runsFixSelfReview, (id: string) => withLive(fixSelfReview(id)));
  handle(CHANNELS.runsRetrySelfReview, (id: string) => withLive(retrySelfReview(id)));
  handle(CHANNELS.runsAcceptSelfReview, (id: string) => withLive(acceptSelfReview(id)));
  handle(CHANNELS.runsDeleteBranch, async (id: string) => withLive(await deleteTaskBranch(id)));
  watchPullRequests();
  handle(CHANNELS.runsSetTicket, (id: string, patch: Parameters<typeof setTicket>[1]) => withLive(setTicket(id, patch)));

  // Project context (core/src/project-context.ts): the notes, and the
  // projects the tasks and Settings › Projects already name, to start one for.
  handle(CHANNELS.projectContextList, async () => {
    const notes = listProjectContexts();
    const have = new Set(notes.map((n) => n.project));
    const suggestions = new Set<string>();
    for (const r of listRuns()) {
      const p = await taskProject(r).catch(() => null);
      if (p && !have.has(p)) suggestions.add(p);
    }
    for (const l of readSettings().projects) if (!have.has(l.repo)) suggestions.add(l.repo);
    return { notes, suggestions: [...suggestions].sort(), template: PROJECT_CONTEXT_TEMPLATE };
  });
  handle(CHANNELS.projectContextSave, (project: string, text: string) => saveProjectContext(project, text));
  handle(CHANNELS.projectContextDelete, (project: string) => deleteProjectContext(project));
  // GitHub Copilot, the second engine (core/src/copilot.ts).
  handle(CHANNELS.copilotAccount, () => copilotAccount());
  handle(CHANNELS.copilotSetToken, (token: string | null) => setCopilotToken(token));
  handle(CHANNELS.copilotLogin, () => startCopilotLogin((ev) => send(CHANNELS.copilotLoginEvent, ev)));
  handle(CHANNELS.copilotCancelLogin, () => cancelCopilotLogin());
  handle(CHANNELS.copilotSignOut, () => copilotSignOut());
  handle(CHANNELS.copilotModels, () => copilotModels());
  handle(CHANNELS.pickFolder, async (title?: string) => {
    const w = win();
    const opts = { title: title || 'Pick a folder', properties: ['openDirectory' as const] };
    const picked = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  // Artifacts (core/src/artifacts.ts).
  handle(CHANNELS.artifactsList, () => listArtifacts());
  handle(CHANNELS.artifactsContent, (id: string, hash?: string) => artifactContent(id, hash));
  handle(CHANNELS.artifactsOpen, async (id: string, hash?: string) => {
    const err = await shell.openPath(artifactFile(id, hash).path);
    if (err) throw new Error(err);
  });
  handle(CHANNELS.artifactsSaveAs, async (id: string, hash?: string) => {
    const f = artifactFile(id, hash);
    const w = win();
    const opts = { defaultPath: path.join(app.getPath('downloads'), f.name) };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(f.path, r.filePath);
    return r.filePath;
  });
  handle(CHANNELS.artifactsDelete, (id: string) => deleteArtifact(id));

  // The run's checkout, in the Finder / Explorer or in VS Code.
  handle(CHANNELS.runsOpenFolder, async (id: string, how: 'folder' | 'vscode') => {
    const dir = workDir(getRun(id));
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
