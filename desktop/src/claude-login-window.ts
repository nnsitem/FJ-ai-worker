import { app, BrowserWindow, session, shell } from 'electron';

/**
 * Claude's sign-in page in a window of the app's own, on a fresh in-memory
 * session — so it never sees the person's own claude.ai sign-in, and
 * nothing of the company one is kept once it closes.
 *
 * The page ends on platform.claude.com's code page; its address carries the
 * code and state, which `claude auth login` takes as `code#state`.
 */
export function openClaudeLoginWindow(url: string, parent: BrowserWindow | null): Promise<string | null> {
  return new Promise((resolve) => {
    const ses = session.fromPartition(`claude-login-${Date.now()}`, { cache: false });
    // Google refuses to sign in inside an app that names itself as one
    // ("This browser or app may not be secure"); the plain Chrome agent.
    const appToken = new RegExp(`\\s(Electron|${app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\/\\S+`, 'g');
    ses.setUserAgent(ses.getUserAgent().replace(appToken, ''));
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      title: 'Sign in to Claude',
      autoHideMenuBar: true,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let settled = false;
    const finish = (code: string | null) => {
      if (settled) return;
      settled = true;
      resolve(code);
      if (!win.isDestroyed()) win.close();
    };
    const check = (target: string) => {
      try {
        const u = new URL(target);
        if (u.hostname.endsWith('claude.com') && u.pathname.includes('/oauth/code/callback')) {
          const code = u.searchParams.get('code');
          const state = u.searchParams.get('state');
          if (code) finish(state ? `${code}#${state}` : code);
        }
      } catch {
        // not a URL we care about
      }
    };
    win.webContents.on('will-redirect', (_e, target) => check(target));
    win.webContents.on('did-navigate', (_e, target) => check(target));
    win.webContents.on('will-navigate', (_e, target) => check(target));
    // Pop-ups (Google's account chooser) stay in the same private session.
    win.webContents.setWindowOpenHandler(({ url: u }) => {
      if (/^https:\/\/(accounts\.google\.com|[\w.-]*claude\.(ai|com))\//.test(u))
        return { action: 'allow', overrideBrowserWindowOptions: { parent: win, webPreferences: { session: ses } } };
      void shell.openExternal(u);
      return { action: 'deny' };
    });
    win.on('closed', () => finish(null));
    void win.loadURL(url);
  });
}
