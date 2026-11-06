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
  jira: { site: string; email: string };
  projects: ProjectLink[];
};
export type ProjectLink = { jiraKey: string; repo: string };
export type SettingsPatch = {
  proxy?: Partial<Settings['proxy']>;
  vpnScript?: string;
  caFile?: string;
  github?: Partial<Settings['github']>;
  claude?: Partial<Settings['claude']>;
  jira?: Partial<Settings['jira']>;
  projects?: ProjectLink[];
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
export type JiraUser = { accountId: string; displayName: string; email: string | null; avatarUrl: string | null };
export type JiraState = { connected: false; site: string; email: string } | { connected: true; site: string; user: JiraUser };
export type JiraProject = { key: string; name: string; avatarUrl: string | null };
export type StatusCategory = 'new' | 'indeterminate' | 'done' | 'undefined';
export type TicketSummary = {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  type: string;
  priority: string | null;
  assignee: string | null;
  updated: string;
  projectKey: string;
  repo: string | null;
};
export type TicketFilter = { projects?: string[]; scope?: 'mine' | 'open' | 'jql'; jql?: string; text?: string; pageToken?: string };
export type TicketDetail = TicketSummary & {
  url: string;
  description: string;
  reporter: string | null;
  created: string | null;
  labels: string[];
  parent: { key: string; summary: string | null } | null;
  comments: { id: string; author: string; created: string; body: string }[];
  commentTotal: number;
  attachments: { id: string; filename: string; size: number; mimeType: string }[];
};
export type StepId = 'analyze' | 'plan' | 'review' | 'fix' | 'test' | 'pr' | 'humanReview';
export type StepState = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';
export type ManualTicket = { key: string; title: string; description: string; url: string | null };
export type RunEvent = { at: string; kind: 'text' | 'tool' | 'system' | 'error' | 'you'; text: string };
export type Run = {
  id: string;
  ticket: ManualTicket;
  repo: string;
  baseBranch: string | null;
  createdAt: string;
  updatedAt: string;
  steps: Record<StepId, StepState>;
  autoApprove: boolean;
  plan: string | null;
  revisions: { at: string; plan: string; feedback: string }[];
  planInTicket: boolean;
  sessionId: string | null;
  error: string | null;
  events: RunEvent[];
  running: boolean;
};
export type ReviewDecision = { kind: 'approve' } | { kind: 'skip' } | { kind: 'changes'; feedback: string };
export type AppInfo = { version: string; platform: string; claudeConfigDir: string; vpnBrowser: boolean };

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
  jiraState(): P<JiraState>;
  jiraConnect(input: { site: string; email: string; token: string }): P<JiraState>;
  jiraDisconnect(): P<void>;
  jiraProjects(): P<JiraProject[]>;
  jiraSearch(filter: TicketFilter): P<{ tickets: TicketSummary[]; nextPageToken: string | null; jql: string }>;
  jiraTicket(key: string): P<TicketDetail>;
  githubAllRepos(): P<RepoSummary[]>;
  runsList(): P<Run[]>;
  runsCreate(input: { ticket: ManualTicket; repo: string; autoApprove: boolean }): P<Run>;
  runsReview(id: string, decision: ReviewDecision): P<Run>;
  runsPlanInTicket(id: string, done: boolean): P<Run>;
  runsStop(id: string): P<Run>;
  runsRerun(id: string): P<Run>;
  runsDelete(id: string): P<void>;
  onRun(cb: (run: Run) => void): () => void;
  openExternal(url: string): P<void>;
  openInVpnBrowser(url: string): P<void>;
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
