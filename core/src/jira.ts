import { adfToText } from './adf.js';
import { httpFetch } from './network.js';
import { getSecret, setSecret } from './secrets.js';
import { getSettings, repoForProject, saveSettings, normaliseSite } from './settings.js';

/**
 * Jira Cloud, as the signed-in person: email + API token (Basic auth). The
 * token is sealed (secrets.ts); site and email are in settings. Calls go
 * through the session (network.ts) — direct, or by the VPN tunnel when the
 * site is in Settings › VPN's hosts (a site that only lets company addresses in).
 */

export type JiraUser = { accountId: string; displayName: string; email: string | null; avatarUrl: string | null };
export type JiraState = { connected: false; site: string; email: string } | { connected: true; site: string; user: JiraUser };

function creds(): { site: string; auth: string } {
  const { site, email } = getSettings().jira;
  const token = getSecret('jira.token');
  if (!site || !email || !token) throw new Error('Connect Jira first (Connections › Jira)');
  return { site, auth: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
}

async function jira<T>(path: string, init: RequestInit = {}, c = creds()): Promise<T> {
  const res = await httpFetch(`${c.site}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: c.auth,
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null;
    const detail = [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].join('; ');
    if (res.status === 401) throw new Error('Jira did not accept the email and API token');
    if (res.status === 403) throw new Error(detail || 'Jira refused — the site may only let company network addresses in (try “Through the VPN”)');
    throw new Error(detail || `Jira answered ${res.status}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

type RawUser = { accountId: string; displayName: string; emailAddress?: string; avatarUrls?: Record<string, string> };
const toUser = (u: RawUser): JiraUser => ({
  accountId: u.accountId,
  displayName: u.displayName,
  email: u.emailAddress ?? null,
  avatarUrl: u.avatarUrls?.['48x48'] ?? null,
});

export async function jiraState(): Promise<JiraState> {
  const { site, email } = getSettings().jira;
  if (!site || !email || !getSecret('jira.token')) return { connected: false, site, email };
  return { connected: true, site, user: toUser(await jira<RawUser>('/rest/api/3/myself')) };
}

/** Checks site + email + token against /myself, then keeps them. */
export async function connectJira(input: { site: string; email: string; token: string }): Promise<JiraState> {
  const site = normaliseSite(input.site);
  const email = input.email.trim();
  const token = input.token.trim() || getSecret('jira.token') || '';
  if (!site || !email || !token) throw new Error('Site, email and API token are all needed');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  const me = await jira<RawUser>('/rest/api/3/myself', {}, { site, auth });
  saveSettings({ jira: { site, email } });
  setSecret('jira.token', token);
  return { connected: true, site, user: toUser(me) };
}

export function disconnectJira(): void {
  setSecret('jira.token', null);
}

// ---- Projects -------------------------------------------------------------

export type JiraProject = { key: string; name: string; avatarUrl: string | null };

export async function listProjects(): Promise<JiraProject[]> {
  const out: JiraProject[] = [];
  for (let startAt = 0; startAt < 1000; startAt += 50) {
    const page = await jira<{ values: { key: string; name: string; avatarUrls?: Record<string, string> }[]; isLast: boolean }>(
      `/rest/api/3/project/search?maxResults=50&startAt=${startAt}&orderBy=name`,
    );
    out.push(...page.values.map((p) => ({ key: p.key, name: p.name, avatarUrl: p.avatarUrls?.['24x24'] ?? null })));
    if (page.isLast || page.values.length === 0) break;
  }
  return out;
}

// ---- Tickets --------------------------------------------------------------

/** Jira's status category: new (to do), indeterminate (in progress), done. */
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
  /** The linked repo (Settings › Projects), if any. */
  repo: string | null;
};

export type TicketFilter = {
  /** Only these projects; none = every project. */
  projects?: string[];
  /** mine: assigned to me, not done (default). open: anyone's, not done. jql: as written. */
  scope?: 'mine' | 'open' | 'jql';
  jql?: string;
  text?: string;
  /** From a previous page. */
  pageToken?: string;
};

const LIST_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'updated', 'project'];

type RawIssue = {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    priority?: { name: string } | null;
    assignee?: RawUser | null;
    reporter?: RawUser | null;
    updated: string;
    created?: string;
    project: { key: string; name?: string };
    description?: unknown;
    labels?: string[];
    comment?: { comments: { id: string; author?: RawUser; body: unknown; created: string }[]; total: number };
    attachment?: { id: string; filename: string; size: number; mimeType: string; content: string }[];
    parent?: { key: string; fields?: { summary?: string } };
  };
};

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The JQL a filter stands for. */
export function filterJql(f: TicketFilter): string {
  if (f.scope === 'jql') {
    if (!f.jql?.trim()) throw new Error('Write a JQL query');
    return f.jql.trim();
  }
  const where: string[] = [];
  if (f.scope !== 'open') where.push('assignee = currentUser()');
  where.push('statusCategory != Done');
  if (f.projects?.length) where.push(`project in (${f.projects.map(quote).join(', ')})`);
  if (f.text?.trim()) {
    const t = f.text.trim();
    where.push(/^[A-Z][A-Z0-9_]+-\d+$/i.test(t) ? `key = ${quote(t.toUpperCase())}` : `text ~ ${quote(t)}`);
  }
  return `${where.join(' AND ')} ORDER BY updated DESC`;
}

function toSummary(i: RawIssue): TicketSummary {
  return {
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status.name,
    statusCategory: (i.fields.status.statusCategory?.key ?? 'undefined') as StatusCategory,
    type: i.fields.issuetype?.name ?? '',
    priority: i.fields.priority?.name ?? null,
    assignee: i.fields.assignee?.displayName ?? null,
    updated: i.fields.updated,
    projectKey: i.fields.project.key,
    repo: repoForProject(i.fields.project.key),
  };
}

export async function searchTickets(f: TicketFilter): Promise<{ tickets: TicketSummary[]; nextPageToken: string | null; jql: string }> {
  const jql = filterJql(f);
  // The enhanced search (POST /search/jql) — the old /search is retired on Cloud.
  const page = await jira<{ issues: RawIssue[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, fields: LIST_FIELDS, maxResults: 50, ...(f.pageToken ? { nextPageToken: f.pageToken } : {}) }),
  });
  return { tickets: page.issues.map(toSummary), nextPageToken: page.nextPageToken ?? null, jql };
}

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

export async function getTicket(key: string): Promise<TicketDetail> {
  if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) throw new Error('Not a ticket key');
  const { site } = creds();
  const fields = [...LIST_FIELDS, 'description', 'reporter', 'created', 'labels', 'comment', 'attachment', 'parent'].join(',');
  const i = await jira<RawIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`);
  const f = i.fields;
  return {
    ...toSummary(i),
    url: `${site}/browse/${i.key}`,
    description: adfToText(f.description),
    reporter: f.reporter?.displayName ?? null,
    created: f.created ?? null,
    labels: f.labels ?? [],
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary ?? null } : null,
    comments: (f.comment?.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author?.displayName ?? 'Someone',
      created: c.created,
      body: adfToText(c.body),
    })),
    commentTotal: f.comment?.total ?? 0,
    attachments: (f.attachment ?? []).map((a) => ({ id: a.id, filename: a.filename, size: a.size, mimeType: a.mimeType })),
  };
}

/** The statuses a ticket can move to from where it is (for Settings' status mapping, M3–M5). */
export async function ticketTransitions(key: string): Promise<{ id: string; name: string; to: string }[]> {
  const r = await jira<{ transitions: { id: string; name: string; to: { name: string } }[] }>(
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
  );
  return r.transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name }));
}
