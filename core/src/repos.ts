import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './config.js';
import { githubToken } from './github.js';
import { baseToolEnv } from './login-env.js';
import { getSettings } from './settings.js';

/**
 * Local checkouts of the company's repos, one clone per repo under the
 * app's data (repos/), and a git worktree per run (worktrees/<run>) so runs
 * never share a working folder.
 *
 * git reaches github.com through the VPN tunnel and signs in with the app's
 * GitHub token — both set for that one command through GIT_CONFIG_* in its
 * environment (never on the command line, where `ps` shows it), so neither
 * the person's git config nor their credentials are used or changed.
 */

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function gitEnv(): Record<string, string> {
  const { host, port } = getSettings().proxy;
  const pairs: [string, string][] = [
    ['http.https://github.com/.proxy', `socks5h://${host}:${port}`],
    // Nobody to answer a password prompt.
    ['credential.helper', ''],
    ['core.askPass', ''],
  ];
  const token = githubToken();
  if (token) pairs.push(['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]);
  const env: Record<string, string> = { ...baseToolEnv(), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

/** What GitHub says when the org's SAML SSO hasn't been granted to the token, as one line with the link. */
function readableGitError(text: string): string {
  const sso = /(https:\/\/github\.com\/(?:enterprises|orgs)\/\S+\/sso\S*)/.exec(text);
  if (sso) return `The organisation uses SAML SSO and the GitHub token isn't authorised for it yet. Authorise it with the link below, then run again: ${sso[1]}`;
  return text.trim().split('\n').slice(-3).join('\n');
}

export function git(args: string[], cwd?: string, timeoutMs = 300000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: gitEnv(), timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(readableGitError(stderr || err.message)));
      else resolve(stdout);
    });
  });
}

export function repoDir(repo: string): string {
  if (!REPO_RE.test(repo)) throw new Error(`Not a GitHub owner/name: ${repo}`);
  return dataPath('repos', repo.replace('/', '__'));
}

/** A clone of the repo, fetched now; returns its folder and default branch. */
export async function syncRepo(repo: string): Promise<{ dir: string; defaultBranch: string }> {
  const dir = repoDir(repo);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    // Blobs on demand: a big repo's history isn't all downloaded up front.
    await git(['clone', '--filter=blob:none', '--no-checkout', `https://github.com/${repo}.git`, dir], undefined, 1800000);
  } else {
    await git(['fetch', 'origin', '--prune'], dir, 900000);
  }
  // origin/HEAD names the default branch; set it if the clone didn't.
  let head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], dir).catch(() => '');
  if (!head.trim()) {
    await git(['remote', 'set-head', 'origin', '--auto'], dir);
    head = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], dir);
  }
  return { dir, defaultBranch: head.trim().replace('refs/remotes/origin/', '') };
}

export function worktreeDir(runId: string): string {
  return dataPath('worktrees', runId);
}

/** A worktree for a run at the tip of the base branch (detached until the fix makes its branch, M4). */
export async function createWorktree(runId: string, repo: string, base: string): Promise<string> {
  const { dir } = await syncRepo(repo);
  const wt = worktreeDir(runId);
  if (fs.existsSync(wt)) return wt;
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  await git(['worktree', 'add', '--detach', wt, `origin/${base}`], dir, 900000);
  return wt;
}

export async function removeWorktree(runId: string, repo: string): Promise<void> {
  const wt = worktreeDir(runId);
  if (!fs.existsSync(wt)) return;
  const dir = repoDir(repo);
  await git(['worktree', 'remove', '--force', wt], dir).catch(() => fs.rmSync(wt, { recursive: true, force: true }));
  await git(['worktree', 'prune'], dir).catch(() => {});
}

/**
 * git in a repo of the person's own (a task's folder): their git config and
 * credentials as they are — only the VPN tunnel set for github.com, and no
 * password prompt (there's nobody to answer it).
 */
export function gitLocal(args: string[], cwd: string, timeoutMs = 300000, extraConfig: [string, string][] = []): Promise<string> {
  const { host, port } = getSettings().proxy;
  // Config through the environment, not -c: nothing in it (a token) shows in `ps`.
  const pairs: [string, string][] = [['http.https://github.com/.proxy', `socks5h://${host}:${port}`], ...extraConfig];
  const env: Record<string, string> = { ...baseToolEnv(), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(readableGitError(stderr || err.message)));
      else resolve(stdout);
    });
  });
}

/** The GitHub owner/name (and any token written into the URL) a local repo's origin points at. */
export async function localOrigin(folder: string): Promise<{ slug: string; token: string | null } | null> {
  const url = (await gitLocal(['config', '--get', 'remote.origin.url'], folder).catch(() => '')).trim();
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if (!m) return null;
  let token: string | null = null;
  try {
    const u = new URL(url);
    token = decodeURIComponent(u.password || '') || null;
  } catch {
    // an ssh-style URL: no token in it
  }
  return { slug: m[1], token };
}
