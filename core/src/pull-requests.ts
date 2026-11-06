import { httpFetch } from './network.js';

/**
 * The GitHub side of steps 6–7: opening a task's pull request and reading
 * back what reviewers said. There is deliberately no merge here — a person
 * merges, on GitHub, after review.
 */

const API = 'https://api.github.com';

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await httpFetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; errors?: { message?: string }[] } | null;
    const sso = res.headers.get('x-github-sso');
    if (sso) throw new Error(`GitHub wants SAML SSO authorisation for this token: ${sso.replace(/^required; url=/, '')}`);
    const detail = [body?.message, ...(body?.errors ?? []).map((e) => e.message)].filter(Boolean).join(' — ');
    throw new Error(detail || `GitHub answered ${res.status}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export type PullRequest = {
  number: number;
  url: string;
  draft: boolean;
  /** open, closed, or merged. */
  state: 'open' | 'closed' | 'merged';
  /** Each reviewer's latest verdict. */
  reviews: { author: string; state: string; at: string }[];
  checkedAt: string;
};

export type Feedback = {
  id: string;
  kind: 'review' | 'line' | 'comment';
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  at: string;
  /** Handed to Claude to deal with. */
  addressed: boolean;
};

type RawPr = { number: number; html_url: string; draft: boolean; state: string; merged_at: string | null; head: { ref: string } };

export async function openPullRequest(
  token: string,
  slug: string,
  input: { head: string; base: string; title: string; body: string; draft: boolean },
): Promise<PullRequest> {
  // Pushed again after a closed one, the branch may already have an open PR.
  const [owner] = slug.split('/');
  const existing = await gh<RawPr[]>(token, `/repos/${slug}/pulls?head=${encodeURIComponent(`${owner}:${input.head}`)}&state=open`);
  const raw = existing[0] ?? (await gh<RawPr>(token, `/repos/${slug}/pulls`, { method: 'POST', body: JSON.stringify(input) }));
  return toPr(raw, []);
}

function toPr(raw: RawPr, reviews: PullRequest['reviews']): PullRequest {
  return {
    number: raw.number,
    url: raw.html_url,
    draft: raw.draft,
    state: raw.merged_at ? 'merged' : raw.state === 'closed' ? 'closed' : 'open',
    reviews,
    checkedAt: new Date().toISOString(),
  };
}

/** The PR as it is now, and everything reviewers have written on it (oldest first). */
export async function readPullRequest(token: string, slug: string, number: number, me: string | null): Promise<{ pr: PullRequest; feedback: Omit<Feedback, 'addressed'>[] }> {
  type User = { login: string; type?: string } | null;
  const [raw, reviews, lines, comments] = await Promise.all([
    gh<RawPr>(token, `/repos/${slug}/pulls/${number}`),
    gh<{ id: number; user: User; state: string; body: string | null; submitted_at: string }[]>(token, `/repos/${slug}/pulls/${number}/reviews?per_page=100`),
    gh<{ id: number; user: User; body: string; path: string; line: number | null; original_line: number | null; created_at: string }[]>(token, `/repos/${slug}/pulls/${number}/comments?per_page=100`),
    gh<{ id: number; user: User; body: string; created_at: string }[]>(token, `/repos/${slug}/issues/${number}/comments?per_page=100`),
  ]);
  // The app's own account (it opened the PR) and bots aren't reviewers.
  const other = (u: User) => !!u && u.login !== me && u.type !== 'Bot';
  const latest = new Map<string, { author: string; state: string; at: string }>();
  for (const rv of reviews) if (other(rv.user) && rv.state !== 'PENDING') latest.set(rv.user!.login, { author: rv.user!.login, state: rv.state, at: rv.submitted_at });
  const feedback: Omit<Feedback, 'addressed'>[] = [
    ...reviews.filter((rv) => other(rv.user) && rv.body?.trim()).map((rv) => ({ id: `r${rv.id}`, kind: 'review' as const, author: rv.user!.login, body: rv.body!.trim(), path: null, line: null, at: rv.submitted_at })),
    ...lines.filter((c) => other(c.user)).map((c) => ({ id: `l${c.id}`, kind: 'line' as const, author: c.user!.login, body: c.body.trim(), path: c.path, line: c.line ?? c.original_line, at: c.created_at })),
    ...comments.filter((c) => other(c.user)).map((c) => ({ id: `c${c.id}`, kind: 'comment' as const, author: c.user!.login, body: c.body.trim(), path: null, line: null, at: c.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { pr: toPr(raw, [...latest.values()]), feedback };
}

/** Who a token is (to leave its own comments out of the feedback). */
export async function tokenLogin(token: string): Promise<string | null> {
  return gh<{ login: string }>(token, '/user').then((u) => u.login).catch(() => null);
}
