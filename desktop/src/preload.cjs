// The window's only way into the main process: a fixed list of calls, never a
// generic invoke(channel, …).
const { contextBridge, ipcRenderer } = require('electron');
const C = require('./channels.json');

contextBridge.exposeInMainWorld('aiWorker', {
  appInfo: () => ipcRenderer.invoke(C.appInfo),
  getSettings: () => ipcRenderer.invoke(C.settingsGet),
  saveSettings: (patch) => ipcRenderer.invoke(C.settingsSave, patch),
  vpnStatus: () => ipcRenderer.invoke(C.vpnStatus),
  openVpnScript: () => ipcRenderer.invoke(C.vpnOpenScript),
  githubState: () => ipcRenderer.invoke(C.githubState),
  githubDeviceStart: () => ipcRenderer.invoke(C.githubDeviceStart),
  githubDeviceFinish: () => ipcRenderer.invoke(C.githubDeviceFinish),
  githubDeviceCancel: () => ipcRenderer.invoke(C.githubDeviceCancel),
  githubUseToken: (token) => ipcRenderer.invoke(C.githubUseToken, token),
  githubFromGh: () => ipcRenderer.invoke(C.githubFromGh),
  githubSignOut: () => ipcRenderer.invoke(C.githubSignOut),
  githubRepos: () => ipcRenderer.invoke(C.githubRepos),
  claudeAccount: () => ipcRenderer.invoke(C.claudeAccount),
  claudeLogin: (inWindow) => ipcRenderer.invoke(C.claudeLogin, inWindow),
  claudeSubmitCode: (code) => ipcRenderer.invoke(C.claudeSubmitCode, code),
  claudeCancelLogin: () => ipcRenderer.invoke(C.claudeCancelLogin),
  claudeLogout: () => ipcRenderer.invoke(C.claudeLogout),
  onClaudeLogin: (cb) => {
    const l = (_e, ev) => cb(ev);
    ipcRenderer.on(C.claudeLoginEvent, l);
    return () => ipcRenderer.removeListener(C.claudeLoginEvent, l);
  },
  jiraState: () => ipcRenderer.invoke(C.jiraState),
  jiraConnect: (input) => ipcRenderer.invoke(C.jiraConnect, input),
  jiraDisconnect: () => ipcRenderer.invoke(C.jiraDisconnect),
  jiraProjects: () => ipcRenderer.invoke(C.jiraProjects),
  jiraSearch: (filter) => ipcRenderer.invoke(C.jiraSearch, filter),
  jiraTicket: (key) => ipcRenderer.invoke(C.jiraTicket, key),
  githubAllRepos: () => ipcRenderer.invoke(C.githubAllRepos),
  runsList: () => ipcRenderer.invoke(C.runsList),
  runsCreate: (input) => ipcRenderer.invoke(C.runsCreate, input),
  runsReview: (id, decision) => ipcRenderer.invoke(C.runsReview, id, decision),
  runsPlanInTicket: (id, done) => ipcRenderer.invoke(C.runsPlanInTicket, id, done),
  runsStop: (id) => ipcRenderer.invoke(C.runsStop, id),
  runsRerun: (id) => ipcRenderer.invoke(C.runsRerun, id),
  runsDelete: (id) => ipcRenderer.invoke(C.runsDelete, id),
  runsMovedInProgress: (id, done) => ipcRenderer.invoke(C.runsMovedInProgress, id, done),
  runsTestCommand: (id, command) => ipcRenderer.invoke(C.runsTestCommand, id, command),
  runsRetryFix: (id) => ipcRenderer.invoke(C.runsRetryFix, id),
  runsRetryTests: (id) => ipcRenderer.invoke(C.runsRetryTests, id),
  runsAcceptTests: (id) => ipcRenderer.invoke(C.runsAcceptTests, id),
  runsChanges: (id) => ipcRenderer.invoke(C.runsChanges, id),
  runsFileDiff: (id, file) => ipcRenderer.invoke(C.runsFileDiff, id, file),
  runsOpenFolder: (id, how) => ipcRenderer.invoke(C.runsOpenFolder, id, how),
  runsSend: (id, text) => ipcRenderer.invoke(C.runsSend, id, text),
  runsStartWorkflow: (id) => ipcRenderer.invoke(C.runsStartWorkflow, id),
  runsSetOptions: (id, opts) => ipcRenderer.invoke(C.runsSetOptions, id, opts),
  libraryList: () => ipcRenderer.invoke(C.libraryList),
  libraryImport: (from) => ipcRenderer.invoke(C.libraryImport, from),
  libraryRemove: (kind, name) => ipcRenderer.invoke(C.libraryRemove, kind, name),
  libraryItem: (kind, name) => ipcRenderer.invoke(C.libraryItem, kind, name),
  libraryCreate: (kind, name, description) => ipcRenderer.invoke(C.libraryCreate, kind, name, description),
  librarySave: (kind, name, text) => ipcRenderer.invoke(C.librarySave, kind, name, text),
  libraryReveal: (kind, name) => ipcRenderer.invoke(C.libraryReveal, kind, name),
  librarySkillFiles: (name) => ipcRenderer.invoke(C.librarySkillFiles, name),
  librarySkillFile: (name, rel) => ipcRenderer.invoke(C.librarySkillFile, name, rel),
  pickFolder: (title) => ipcRenderer.invoke(C.pickFolder, title),
  runsSetPlace: (id, place) => ipcRenderer.invoke(C.runsSetPlace, id, place),
  runsApprovePush: (id) => ipcRenderer.invoke(C.runsApprovePush, id),
  runsMovedToReview: (id, done) => ipcRenderer.invoke(C.runsMovedToReview, id, done),
  runsCheckPr: (id) => ipcRenderer.invoke(C.runsCheckPr, id),
  runsFixReview: (id) => ipcRenderer.invoke(C.runsFixReview, id),
  runsFinishReview: (id) => ipcRenderer.invoke(C.runsFinishReview, id),
  runsDeleteBranch: (id) => ipcRenderer.invoke(C.runsDeleteBranch, id),
  runsSetTicket: (id, patch) => ipcRenderer.invoke(C.runsSetTicket, id, patch),
  projectContextList: () => ipcRenderer.invoke(C.projectContextList),
  projectContextSave: (project, text) => ipcRenderer.invoke(C.projectContextSave, project, text),
  projectContextDelete: (project) => ipcRenderer.invoke(C.projectContextDelete, project),
  artifactsList: () => ipcRenderer.invoke(C.artifactsList),
  artifactsContent: (id, hash) => ipcRenderer.invoke(C.artifactsContent, id, hash),
  artifactsOpen: (id, hash) => ipcRenderer.invoke(C.artifactsOpen, id, hash),
  artifactsSaveAs: (id, hash) => ipcRenderer.invoke(C.artifactsSaveAs, id, hash),
  artifactsDelete: (id) => ipcRenderer.invoke(C.artifactsDelete, id),
  onRun: (cb) => {
    const l = (_e, run) => cb(run);
    ipcRenderer.on(C.runsEvent, l);
    return () => ipcRenderer.removeListener(C.runsEvent, l);
  },
  termList: () => ipcRenderer.invoke(C.termList),
  termOpen: (kind, cols, rows) => ipcRenderer.invoke(C.termOpen, kind, cols, rows),
  termBuffer: (id) => ipcRenderer.invoke(C.termBuffer, id),
  // Keystrokes and size: fire-and-forget, many a second.
  termWrite: (id, data) => ipcRenderer.send(C.termWrite, id, data),
  termResize: (id, cols, rows) => ipcRenderer.send(C.termResize, id, cols, rows),
  termClose: (id) => ipcRenderer.invoke(C.termClose, id),
  onTerminal: (cb) => {
    const l = (_e, ev) => cb(ev);
    ipcRenderer.on(C.termEvent, l);
    return () => ipcRenderer.removeListener(C.termEvent, l);
  },
  openExternal: (url) => ipcRenderer.invoke(C.openExternal, url),
  openInVpnBrowser: (url) => ipcRenderer.invoke(C.openInVpnBrowser, url),
});
