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
  openExternal: (url) => ipcRenderer.invoke(C.openExternal, url),
  openInVpnBrowser: (url) => ipcRenderer.invoke(C.openInVpnBrowser, url),
});
