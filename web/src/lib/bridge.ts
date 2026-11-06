/**
 * The desktop app's preload API (desktop/src/preload.cjs). Every call
 * answers {ok, value} or {ok: false, error}; `call` turns the second into a
 * thrown Error with the main process's message.
 */

export type Settings = {
  proxy: { host: string; port: number; hosts: string[] };
  vpnScript: string;
  caFile: string;
  github: { clientId: string };
  claude: { expectedEmail: string };
};
export type SettingsPatch = {
  proxy?: Partial<Settings['proxy']>;
  vpnScript?: string;
  caFile?: string;
  github?: Partial<Settings['github']>;
  claude?: Partial<Settings['claude']>;
};
export type VpnStatus = { tunnel: boolean; github: boolean; error?: string; checkedAt: string };
export type GithubUser = { login: string; name: string | null; avatarUrl: string };
export type GithubState = { signedIn: false } | { signedIn: true; user: GithubUser; scopes: string[] };
export type DeviceCode = { userCode: string; verificationUri: string; expiresAt: number };
export type RepoSummary = { fullName: string; private: boolean; pushedAt: string | null; url: string };
export type ClaudeAccount = {
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  authMethod: string | null;
  loginExpiresAt: string | null;
  expectedEmail: string | null;
  ok: boolean;
};
export type ClaudeLoginEvent =
  | { kind: 'done'; account: ClaudeAccount }
  | { kind: 'error'; error: string }
  | { kind: 'closed' };
export type AppInfo = { version: string; platform: string; claudeConfigDir: string };

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
type P<T> = Promise<Reply<T>>;

type Bridge = {
  appInfo(): P<AppInfo>;
  getSettings(): P<Settings>;
  saveSettings(patch: SettingsPatch): P<Settings>;
  vpnStatus(): P<VpnStatus>;
  openVpnScript(): P<void>;
  githubState(): P<GithubState>;
  githubDeviceStart(): P<DeviceCode>;
  githubDeviceFinish(): P<GithubState>;
  githubDeviceCancel(): P<void>;
  githubUseToken(token: string): P<GithubState>;
  githubFromGh(): P<GithubState>;
  githubSignOut(): P<void>;
  githubRepos(): P<RepoSummary[]>;
  claudeAccount(): P<ClaudeAccount>;
  claudeLogin(inWindow: boolean): P<{ url: string }>;
  claudeSubmitCode(code: string): P<ClaudeAccount>;
  claudeCancelLogin(): P<void>;
  claudeLogout(): P<ClaudeAccount>;
  onClaudeLogin(cb: (ev: ClaudeLoginEvent) => void): () => void;
  openExternal(url: string): P<void>;
};

declare global {
  interface Window {
    aiWorker?: Bridge;
  }
}

export function bridge(): Bridge {
  if (typeof window === 'undefined' || !window.aiWorker) throw new Error('Open AI Worker in its desktop app');
  return window.aiWorker;
}

type Method = { [K in keyof Bridge]: Bridge[K] extends (...a: never[]) => P<unknown> ? K : never }[keyof Bridge];

export async function call<K extends Method>(
  name: K,
  ...args: Parameters<Bridge[K]>
): Promise<Awaited<ReturnType<Bridge[K]>> extends Reply<infer T> ? T : never> {
  const fn = bridge()[name] as (...a: unknown[]) => P<unknown>;
  const r = await fn(...args);
  if (!r.ok) throw new Error(r.error);
  return r.value as never;
}
