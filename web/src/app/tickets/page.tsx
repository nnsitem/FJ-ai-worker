'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call, type JiraProject, type StatusCategory, type TicketDetail, type TicketFilter, type TicketSummary } from '@/lib/bridge';

const TONE: Record<StatusCategory, string | undefined> = { new: undefined, indeterminate: 'info', done: 'ok', undefined: undefined };

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : '2-digit' });
};

const SCOPES: { id: NonNullable<TicketFilter['scope']>; label: string }[] = [
  { id: 'mine', label: 'Assigned to me' },
  { id: 'open', label: 'All open' },
  { id: 'jql', label: 'JQL' },
];

/** Jira tickets: a filtered list, and the open one's details beside it. */
export default function TicketsPage() {
  const [scope, setScope] = useState<NonNullable<TicketFilter['scope']>>('mine');
  const [project, setProject] = useState('');
  const [text, setText] = useState('');
  const [jql, setJql] = useState('');
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    call('jiraProjects').then(setProjects).catch(() => {});
  }, []);

  const filter = useCallback(
    (): TicketFilter => ({ scope, projects: project ? [project] : [], text, jql }),
    [scope, project, text, jql],
  );

  const load = useCallback(
    async (more = false) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const r = await call('jiraSearch', { ...filter(), pageToken: more ? (next ?? undefined) : undefined });
        if (mine !== seq.current) return;
        setTickets((t) => (more && t ? [...t, ...r.tickets] : r.tickets));
        setNext(r.nextPageToken);
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [filter, next],
  );

  // Scope and project load at once; text and JQL on Enter / Search.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list follows the filter
    if (scope !== 'jql') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- not on every keystroke
  }, [scope, project]);

  const notConnected = error?.startsWith('Connect Jira first');

  return (
    <div className="aw-tickets">
      <div className="aw-tickets-list">
        <div className="aw-tickets-head">
          <h1>Tickets</h1>
          <div className="aw-tabs" role="tablist">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className="aw-tab" onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          <form
            className="aw-row aw-tickets-filter"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            {scope === 'jql' ? (
              <input className="aw-input aw-mono" value={jql} onChange={(e) => setJql(e.target.value)} placeholder='project = BF9 AND status = "To Do" ORDER BY created DESC' />
            ) : (
              <>
                <select className="aw-input aw-select" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
                  ))}
                </select>
                <input className="aw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search, or a key like BF9-123" />
              </>
            )}
            <button type="submit" className="aw-btn" disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
          </form>
        </div>

        {notConnected ? (
          <p className="aw-muted aw-pad">Jira isn&apos;t connected yet — <Link href="/">Connections</Link>.</p>
        ) : error ? (
          <p className="aw-error aw-pad">{error}</p>
        ) : tickets && tickets.length === 0 ? (
          <p className="aw-muted aw-pad">No tickets match.</p>
        ) : (
          <ul className="aw-ticket-rows">
            {tickets?.map((t) => (
              <li key={t.key}>
                <button type="button" className="aw-ticket-row" aria-current={openKey === t.key || undefined} onClick={() => setOpenKey(t.key)}>
                  <span className="aw-ticket-key aw-mono">{t.key}</span>
                  <span className="aw-ticket-summary">{t.summary}</span>
                  <span className="aw-pill" data-tone={TONE[t.statusCategory]}>{t.status}</span>
                  <span className="aw-ticket-meta">
                    {t.type}
                    {t.assignee && scope !== 'mine' ? ` · ${t.assignee}` : ''} · {when(t.updated)}
                    {!t.repo && <span className="aw-ticket-norepo"> · no repo</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {next && !error && (
          <div className="aw-pad">
            <button type="button" className="aw-btn" disabled={loading} onClick={() => void load(true)}>Load more</button>
          </div>
        )}
      </div>

      <div className="aw-tickets-detail">
        {openKey ? <TicketPanel key={openKey} ticketKey={openKey} /> : <p className="aw-muted aw-pad">Pick a ticket to see it here.</p>}
      </div>
    </div>
  );
}

function TicketPanel({ ticketKey }: { ticketKey: string }) {
  const [t, setT] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('jiraTicket', ticketKey).then(setT).catch((e) => setError((e as Error).message));
  }, [ticketKey]);

  if (error) return <p className="aw-error aw-pad">{error}</p>;
  if (!t) return <p className="aw-muted aw-pad">Loading {ticketKey}…</p>;

  return (
    <article className="aw-ticket">
      <div className="aw-row">
        <span className="aw-mono aw-muted">{t.key}</span>
        <span className="aw-pill" data-tone={TONE[t.statusCategory]}>{t.status}</span>
        <span className="aw-muted">{t.type}{t.priority && ` · ${t.priority}`}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="aw-link-btn" onClick={() => void call('openExternal', t.url)}>Open in Jira</button>
      </div>
      <h2>{t.summary}</h2>
      <dl className="aw-ticket-facts">
        <dt>Assignee</dt><dd>{t.assignee ?? 'Unassigned'}</dd>
        <dt>Reporter</dt><dd>{t.reporter ?? '—'}</dd>
        <dt>Updated</dt><dd>{when(t.updated)}</dd>
        {t.parent && (<><dt>Parent</dt><dd><span className="aw-mono">{t.parent.key}</span> {t.parent.summary}</dd></>)}
        {t.labels.length > 0 && (<><dt>Labels</dt><dd>{t.labels.join(', ')}</dd></>)}
        <dt>Repo</dt>
        <dd>{t.repo ? <span className="aw-mono">{t.repo}</span> : <span className="aw-ticket-norepo">None — link {t.projectKey} to a repo in <Link href="/settings">Settings</Link></span>}</dd>
      </dl>

      <section>
        <h3>Description</h3>
        {t.description ? <div className="aw-prose">{t.description}</div> : <p className="aw-muted">No description.</p>}
      </section>

      {t.attachments.length > 0 && (
        <section>
          <h3>Attachments</h3>
          <ul className="aw-list">
            {t.attachments.map((a) => (
              <li key={a.id}><span>{a.filename}</span><span className="aw-muted">{Math.ceil(a.size / 1024)} KB</span></li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Comments{t.commentTotal > t.comments.length ? ` (latest ${t.comments.length} of ${t.commentTotal})` : t.comments.length ? ` (${t.comments.length})` : ''}</h3>
        {t.comments.length === 0 ? (
          <p className="aw-muted">None.</p>
        ) : (
          t.comments.map((c) => (
            <div key={c.id} className="aw-comment">
              <div className="aw-muted"><strong>{c.author}</strong> · {when(c.created)}</div>
              <div className="aw-prose">{c.body}</div>
            </div>
          ))
        )}
      </section>
    </article>
  );
}
