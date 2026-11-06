'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Picker } from '@/components/Picker';
import { CloseIcon, LinkIcon, SearchIcon, TicketsIcon } from '@/components/icons';
import { call, type JiraProject, type StatusCategory, type TicketDetail, type TicketFilter, type TicketSummary } from '@/lib/bridge';
import { usePanelResize } from '@/lib/use-panel-resize';

/** Jira's status category, in the app's one status set (board.css .ao-chip-status). */
const STATUS: Record<StatusCategory, string> = { new: 'todo', indeterminate: 'in_progress', done: 'done', undefined: 'todo' };
// Must match the slide-out on .ao-task-panel[data-closing] (team.css).
const PANEL_CLOSE_MS = 220;

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

/** Jira tickets, on the boards' panel system: a filtered list, and the open one in the side panel. */
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
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const { boardRef, width: panelWidth, startResize, resetWidth } = usePanelResize();

  useEffect(() => {
    call('jiraProjects').then(setProjects).catch(() => {});
  }, []);

  const filter = useCallback((): TicketFilter => ({ scope, projects: project ? [project] : [], text, jql }), [scope, project, text, jql]);

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

  const openPanel = (key: string) => {
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    if (key !== openKey) resetWidth();
    setOpenKey(key);
  };
  const closePanel = () => {
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpenKey(null);
      setClosing(false);
    }, PANEL_CLOSE_MS);
  };

  const notConnected = error?.startsWith('Connect Jira first');

  return (
    <main className="ao-board" ref={boardRef}>
      <section className="ao-panel ao-sessions">
        <header className="ao-panel-head">
          <h2 className="ao-panel-title">Tickets</h2>
          <span className="ao-count">{tickets?.length ?? 0}</span>
          <div className="ao-spacer" />
          <div className="ao-view-toggle" role="tablist" aria-label="Which tickets">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} data-active={scope === s.id} className="ao-view-btn" onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </header>

        <form
          className="ao-art-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          {scope === 'jql' ? (
            <div className="ao-search-field ao-jql-field">
              <SearchIcon size={14} />
              <input className="ao-search-input ao-mono-input" value={jql} onChange={(e) => setJql(e.target.value)} placeholder='project = BF9 AND status = "To Do" ORDER BY created DESC' aria-label="JQL" />
            </div>
          ) : (
            <>
              <Picker<string>
                value={project}
                onChange={setProject}
                options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.key, label: p.key, hint: p.name }))]}
                placement="down-start"
                ariaLabel="Project"
              />
              <span className="ao-spacer" />
              <div className="ao-search-field ao-team-search">
                <SearchIcon size={14} />
                <input className="ao-search-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search, or a key like BF9-123" aria-label="Search tickets" />
                {text && (
                  <button type="button" className="ao-icon-btn" onClick={() => setText('')} aria-label="Clear search">
                    <CloseIcon size={13} />
                  </button>
                )}
              </div>
            </>
          )}
          <button type="submit" className="ao-btn-secondary ao-btn-compact" disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </button>
        </form>

        <ul className="ao-list">
          {notConnected ? (
            <li className="ao-column-empty">
              Jira isn&apos;t connected yet — <Link href="/" className="ao-inline-link">Connections</Link>.
            </li>
          ) : error ? (
            <li className="ao-task-panel-error ao-inset-note">{error}</li>
          ) : tickets && tickets.length === 0 ? (
            <li className="ao-column-empty">No tickets match.</li>
          ) : (
            tickets?.map((t) => (
              <li key={t.key}>
                <div
                  className="ao-card"
                  role="button"
                  tabIndex={0}
                  data-status={STATUS[t.statusCategory]}
                  data-active={openKey === t.key && !closing}
                  onClick={() => (openKey === t.key && !closing ? closePanel() : openPanel(t.key))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openPanel(t.key);
                    }
                  }}
                >
                  <div className="ao-card-meta">
                    <span className="ao-card-src">
                      <span className="ao-card-key">{t.key}</span>
                      <span className="ao-dot-sep">·</span>
                      <span className="ao-card-repo">{t.type}</span>
                      {t.assignee && scope !== 'mine' && (
                        <>
                          <span className="ao-dot-sep">·</span>
                          <span className="ao-card-repo">{t.assignee}</span>
                        </>
                      )}
                    </span>
                    <span className="ao-card-when">{when(t.updated)}</span>
                  </div>
                  <p className="ao-card-title">{t.summary}</p>
                  <div className="ao-card-chips">
                    <span className="ao-chip ao-chip-status" data-status={STATUS[t.statusCategory]}>
                      {t.status}
                    </span>
                    {t.priority && <span className="ao-chip">{t.priority}</span>}
                    {t.repo ? <span className="ao-chip">{t.repo}</span> : <span className="ao-chip ao-chip-warn">no repo</span>}
                  </div>
                </div>
              </li>
            ))
          )}
          {next && !error && (
            <li className="ao-load-more">
              <button type="button" className="ao-btn-secondary ao-btn-compact" disabled={loading} onClick={() => void load(true)}>
                Load more
              </button>
            </li>
          )}
        </ul>
      </section>

      {openKey && (
        <>
          {!closing && <div className="ao-resizer" onMouseDown={startResize} />}
          <section className="ao-panel ao-detail ao-task-panel" data-closing={closing || undefined} style={{ flexBasis: `${panelWidth}px` }} aria-label={openKey}>
            <div className="ao-task-panel-inner" style={{ width: `${panelWidth}px` }}>
              <TicketPanel key={openKey} ticketKey={openKey} onClose={closePanel} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

/** One ticket, as AI Office's task side panel: its facts, description, attachments and comments. */
function TicketPanel({ ticketKey, onClose }: { ticketKey: string; onClose: () => void }) {
  const [t, setT] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('jiraTicket', ticketKey).then(setT).catch((e) => setError((e as Error).message));
  }, [ticketKey]);

  return (
    <>
      <header className="ao-task-panel-head">
        <div className="ao-task-panel-heading">
          <div className="ao-task-panel-meta">
            <span className="ao-team-tag" data-kind="project">
              {ticketKey}
            </span>
            {t && (
              <>
                <span className="ao-chip ao-chip-status" data-status={STATUS[t.statusCategory]}>
                  {t.status}
                </span>
                <span className="ao-task-panel-id">
                  {t.type}
                  {t.priority && ` · ${t.priority}`}
                </span>
              </>
            )}
          </div>
          <h2 className="ao-task-panel-title">{t?.summary ?? (error ? 'Couldn’t load it' : `Loading ${ticketKey}…`)}</h2>
        </div>
        <button type="button" className="ao-icon-btn" onClick={onClose} aria-label="Close panel" title="Close">
          <CloseIcon size={15} />
        </button>
      </header>

      <div className="ao-task-panel-body">
        {error && <p className="ao-task-panel-error">{error}</p>}
        {!t && !error && (
          <div className="ao-art-preview-skel">
            <span className="ao-skel-line" style={{ width: '60%' }} />
            <span className="ao-skel-line" style={{ width: '92%' }} />
          </div>
        )}
        {t && (
          <>
            <div className="ao-task-panel-grid">
              <div>
                <p className="ao-task-panel-label">Assignee</p>
                <p className="ao-task-panel-value">{t.assignee ?? 'Unassigned'}</p>
              </div>
              <div>
                <p className="ao-task-panel-label">Reporter</p>
                <p className="ao-task-panel-value">{t.reporter ?? '—'}</p>
              </div>
              <div>
                <p className="ao-task-panel-label">Updated</p>
                <p className="ao-task-panel-value">{when(t.updated)}</p>
              </div>
              {t.parent && (
                <div>
                  <p className="ao-task-panel-label">Parent</p>
                  <p className="ao-task-panel-value" title={t.parent.summary ?? undefined}>
                    <span className="ao-task-panel-strong">{t.parent.key}</span>
                  </p>
                </div>
              )}
              {t.labels.length > 0 && (
                <div>
                  <p className="ao-task-panel-label">Labels</p>
                  <p className="ao-task-panel-value">{t.labels.join(', ')}</p>
                </div>
              )}
            </div>

            <section>
              <p className="ao-task-panel-label">Repo</p>
              {t.repo ? (
                <p className="ao-task-panel-value">
                  <code>{t.repo}</code>
                </p>
              ) : (
                <p className="ao-task-panel-muted">
                  None — link {t.projectKey} to a repo in <Link href="/settings" className="ao-inline-link">Settings</Link>.
                </p>
              )}
            </section>

            <section>
              <p className="ao-task-panel-label">Description</p>
              <div className="ao-task-panel-desc" data-empty={!t.description}>
                {t.description || 'No description.'}
              </div>
            </section>

            {t.attachments.length > 0 && (
              <section>
                <p className="ao-task-panel-label">Attachments</p>
                <ul className="ao-pipe-runs">
                  {t.attachments.map((a) => (
                    <li key={a.id} className="ao-pipe-run ao-static-row">
                      <span className="ao-pipe-run-stage">{a.filename}</span>
                      <span className="ao-spacer" />
                      <span className="ao-pipe-run-meta">{Math.ceil(a.size / 1024)} KB</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="ao-task-panel-comments">
              <p className="ao-task-panel-label">
                Comments
                <span className="ao-task-panel-id">{t.commentTotal > t.comments.length ? `latest ${t.comments.length} of ${t.commentTotal}` : t.comments.length || ''}</span>
              </p>
              {t.comments.length === 0 ? (
                <p className="ao-task-panel-muted">None.</p>
              ) : (
                <ul className="ao-task-panel-comment-list">
                  {t.comments.map((c) => (
                    <li key={c.id} className="ao-task-panel-comment">
                      <div className="ao-task-panel-comment-main">
                        <div className="ao-task-panel-comment-head">
                          <span className="ao-task-panel-comment-author">{c.author}</span>
                          <span className="ao-task-panel-comment-time">{when(c.created)}</span>
                        </div>
                        <p className="ao-task-panel-comment-body">{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {t && (
        <footer className="ao-task-panel-foot">
          <span className="ao-task-panel-muted">
            <TicketsIcon size={13} /> {t.projectKey}
          </span>
          <div className="ao-task-panel-actions">
            <button type="button" className="ao-btn-secondary" onClick={() => void call('openExternal', t.url)}>
              <LinkIcon size={14} /> Open in Jira
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
