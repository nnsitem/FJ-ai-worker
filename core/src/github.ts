import { execFile } from 'node:child_process';
import { httpFetch, toolEnv } from './network.js';
import { getSettings } from './settings.js';
import { getSecret, setSecret } from './secrets.js';
import { baseToolEnv } from './login-env.js';

/**
 * Signing in to github.com (through the VPN tunnel, network.ts). Three ways:
 * - the device flow, with the company's OAuth App (Settings › GitHub client id);
 * - a personal access token pasted in;
 * - the token gh already holds, when someone signed in there.
 * Whichever it is, the token is sealed (secrets.ts) and checked against
 * /user before it's kept.
 */

const API = 'https://api.github.com';
/** repo: read and push code, open PRs. read:org: see the org's repos. */
const SCOPES = 'repo read:org';

export type GithubUser = { login: string; name: string | null; avatarUrl: string };

export type GithubState =
  | { signedIn: false }
  | { signedIn: true; user: GithubUser; scopes: string[] };

async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return httpFetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
}

async function readUser(token: string): Promise<{ user: GithubUser; scopes: string[] }> {
  const res = await api('/user', token);
  if (res.status === 401) throw new Error('GitHub did not accept the token');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const u = (await res.json()) as { login: string; name: string | null; avatar_url: string };
  const scopes = (res.headers.get('x-oauth-scopes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { user: { login: u.login, name: u.name, avatarUrl: u.avatar_url }, scopes };
}

export function githubToken(): string | null {
  return getSecret('github.token');
}

export async function githubState(): Promise<GithubState> {
  const token = githubToken();
  if (!token) return { signedIn: false };
  const { user, scopes } = await readUser(token);
  return { signedIn: true, user, scopes };
}

/** Checks a token and keeps it. */
export async function useToken(token: string): Promise<GithubState> {
  const t = token.trim();
  if (!t) throw new Error('No token given');
  const { user, scopes } = await readUser(t);
  setSecret('github.token', t);
  return { signedIn: true, user, scopes };
}

export function signOutGithub(): void {
  setSecret('github.token', null);
}

/** The token gh holds for github.com (its keyring; no network). */
export function tokenFromGh(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', ['auth', 'token', '--hostname', 'github.com'], { env: { ...baseToolEnv(), ...toolEnv('gh') }, timeout: 10000 }, (err, stdout, stderr) => {
      const token = stdout?.trim();
      if (err || !token) reject(new Error((stderr || err?.message || 'gh has no GitHub sign-in').trim()));
      else resolve(token);
    });
  });
}

// ---- Device flow ----------------------------------------------------------

export type DeviceCode = { userCode: string; verificationUri: string; expiresAt: number };

let device: { code: string; interval: number; expiresAt: number; clientId: string; cancelled: boolean } | null = null;

export async function startDeviceFlow(): Promise<DeviceCode> {
  const clientId = getSettings().github.clientId.trim();
  if (!clientId) throw new Error('Set the GitHub OAuth App client id in Settings first');
  const res = await httpFetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error_description?: string; error?: string;
  };
  if (!res.ok || !body.device_code || !body.user_code)
    throw new Error(body.error_description || body.error || `GitHub answered ${res.status}`);
  if (device) device.cancelled = true;
  const expiresAt = Date.now() + (body.expires_in ?? 900) * 1000;
  device = { code: body.device_code, interval: body.interval ?? 5, expiresAt, clientId, cancelled: false };
  return { userCode: body.user_code, verificationUri: body.verification_uri ?? 'https://github.com/login/device', expiresAt };
}

/** Waits for the person to enter the code on GitHub, then keeps the token. */
export async function finishDeviceFlow(): Promise<GithubState> {
  const d = device;
  if (!d) throw new Error('No sign-in in progress');
  let interval = d.interval;
  while (!d.cancelled && Date.now() < d.expiresAt) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    if (d.cancelled) break;
    const res = await httpFetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: d.clientId,
        device_code: d.code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (!res) continue; // a blip in the tunnel; try again next round
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string; interval?: number };
    if (body.access_token) {
      device = null;
      return useToken(body.access_token);
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval = body.interval ?? interval + 5;
      continue;
    }
    device = null;
    throw new Error(body.error === 'access_denied' ? 'Sign-in was declined on GitHub' : body.error_description || body.error || 'Sign-in failed');
  }
  if (device === d) device = null;
  throw new Error(d.cancelled ? 'Sign-in cancelled' : 'The code expired — start again');
}

export function cancelDeviceFlow(): void {
  if (device) device.cancelled = true;
  device = null;
}

// ---- What the token can reach (M1's check) --------------------------------

export type RepoSummary = { fullName: string; private: boolean; pushedAt: string | null; url: string };

/** The repos the signed-in person can reach, most recently pushed first. */
export async function listRepos(limit = 50): Promise<RepoSummary[]> {
  const token = githubToken();
  if (!token) throw new Error('Not signed in to GitHub');
  const res = await api(`/user/repos?per_page=${Math.min(limit, 100)}&sort=pushed&affiliation=owner,collaborator,organization_member`, token);
  if (!res.ok) {
    const sso = res.headers.get('x-github-sso');
    throw new Error(sso ? `The token needs SSO authorisation for the organisation: ${sso}` : `GitHub answered ${res.status}`);
  }
  const rows = (await res.json()) as { full_name: string; private: boolean; pushed_at: string | null; html_url: string }[];
  return rows.map((r) => ({ fullName: r.full_name, private: r.private, pushedAt: r.pushed_at, url: r.html_url }));
}
