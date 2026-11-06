import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { dataPath } from './config.js';
import { baseToolEnv } from './login-env.js';
import { toolEnv } from './network.js';
import { getSettings } from './settings.js';

/**
 * AI Worker's own Claude account — the company's — kept apart from the
 * person's own Claude Code:
 * - its own config folder (CLAUDE_CONFIG_DIR, under the app's data). Claude
 *   Code keys its stored sign-in to that folder, so signing in here neither
 *   reads nor replaces the terminal's ~/.claude sign-in;
 * - an environment built from scratch (login-env.ts baseToolEnv): no
 *   ANTHROPIC_* or CLAUDE_* from the person's shell can pick another account.
 *
 * Sign-in runs `claude auth login` in that folder. The CLI prints a URL and
 * waits for the code the sign-in page ends on; the desktop app opens the URL
 * in a window of its own (a private session, so not the person's Claude) and
 * hands the code back (submitClaudeCode).
 */

let executable: string | null = null;

/** The `claude` binary the app runs (the desktop app finds it at start-up). */
export function setClaudeExecutable(p: string | null): void {
  executable = p;
}

function claudeBin(): string {
  return executable ?? 'claude';
}

export function claudeConfigDir(): string {
  const dir = dataPath('claude');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The environment every Claude run gets: the company account, the VPN's routing. */
export function claudeEnv(): Record<string, string> {
  return { ...baseToolEnv(), ...toolEnv('claude'), CLAUDE_CONFIG_DIR: claudeConfigDir() };
}

export type ClaudeAccount = {
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  authMethod: string | null;
  loginExpiresAt: string | null;
  /** Settings › Claude's company email, when one is set. */
  expectedEmail: string | null;
  /** Signed in, and as the company account (or no company email set). */
  ok: boolean;
};

export function claudeAccount(): Promise<ClaudeAccount> {
  return new Promise((resolve, reject) => {
    execFile(claudeBin(), ['auth', 'status', '--json'], { env: claudeEnv(), timeout: 20000 }, (err, stdout, stderr) => {
      let j: Record<string, unknown> | null = null;
      try {
        j = JSON.parse(stdout);
      } catch {
        // falls through
      }
      // `auth status` exits non-zero when signed out, with the JSON still printed.
      if (!j) return reject(new Error((stderr || err?.message || 'Could not read the Claude sign-in').trim()));
      const str = (k: string) => (typeof j![k] === 'string' && j![k] ? (j![k] as string) : null);
      const loggedIn = j.loggedIn === true;
      const email = str('email');
      const expectedEmail = getSettings().claude.expectedEmail || null;
      resolve({
        loggedIn,
        email,
        orgName: str('orgName'),
        subscriptionType: str('subscriptionType'),
        authMethod: str('authMethod'),
        loginExpiresAt: str('loginExpiresAt'),
        expectedEmail,
        ok: loggedIn && (!expectedEmail || email?.toLowerCase() === expectedEmail),
      });
    });
  });
}

/** Throws unless runs may go ahead under the company account. */
export async function assertClaudeAccount(): Promise<ClaudeAccount> {
  const a = await claudeAccount();
  if (!a.loggedIn) throw new Error('Sign in to Claude first (Settings › Claude)');
  if (!a.ok) throw new Error(`Claude is signed in as ${a.email}, not the company account ${a.expectedEmail}`);
  return a;
}

// ---- Sign-in ----------------------------------------------------------------

let login: { proc: ChildProcessWithoutNullStreams; out: string; done: Promise<void> } | null = null;

const stripAnsi = (s: string) =>
  // OSC 8 hyperlinks (ESC ] 8 ;; url BEL text ESC ] 8 ;; BEL) and colour codes.
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\]8;;[^\x07\x1b]*(\x07|\x1b\\)/g, ' ').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** Starts `claude auth login`; resolves with the URL to sign in at. */
export function startClaudeLogin(email?: string): Promise<{ url: string }> {
  cancelClaudeLogin();
  const args = ['auth', 'login', '--claudeai'];
  const hint = (email ?? getSettings().claude.expectedEmail).trim();
  if (hint) args.push('--email', hint);
  // The app opens the URL itself, in its own window — not the person's browser,
  // which is likely signed in to their own Claude.
  const env = { ...claudeEnv(), ...(process.platform === 'win32' ? {} : { BROWSER: '/usr/bin/true' }) };
  const proc = spawn(claudeBin(), args, { env, stdio: 'pipe' });
  const state = { proc, out: '', done: Promise.resolve() };
  state.done = new Promise<void>((resolve) => proc.once('close', () => resolve()));
  login = state;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Claude did not offer a sign-in link')), 30000);
    const onData = (d: Buffer) => {
      state.out += d.toString();
      const m = /https:\/\/\S+oauth\/authorize\?\S+/.exec(stripAnsi(state.out));
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0] });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(stripAnsi(state.out).trim().split('\n').pop() || `Claude exited (${code})`));
    });
  });
}

/** The code from the sign-in page (`code#state`); resolves with the account it signed in. */
export async function submitClaudeCode(code: string): Promise<ClaudeAccount> {
  const l = login;
  if (!l) throw new Error('No Claude sign-in in progress');
  const c = code.trim();
  if (!c) throw new Error('No code given');
  l.proc.stdin.write(`${c}\n`);
  const finished = await Promise.race([l.done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 60000))]);
  if (login === l) login = null;
  if (!finished) {
    l.proc.kill();
    throw new Error('Claude did not finish signing in');
  }
  if (l.proc.exitCode !== 0) {
    const last = stripAnsi(l.out).trim().split('\n').filter(Boolean).pop();
    throw new Error(last || 'Claude did not accept the code');
  }
  return claudeAccount();
}

export function cancelClaudeLogin(): void {
  if (login && login.proc.exitCode == null) login.proc.kill();
  login = null;
}

export function claudeLogout(): Promise<ClaudeAccount> {
  return new Promise((resolve, reject) => {
    execFile(claudeBin(), ['auth', 'logout'], { env: claudeEnv(), timeout: 20000 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(claudeAccount());
    });
  });
}
