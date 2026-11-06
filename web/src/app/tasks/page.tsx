'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AddIcon, PanelIcon, RunsIcon } from '@/components/icons';
import { bridge, call, type Run } from '@/lib/bridge';
import { NEW_TASK_AGENT_KEY, OPEN_TASK_KEY } from '@/lib/models';
import { TaskView } from './TaskView';
import { currentStep, STEP_LABELS } from './steps';

type Tab = 'all' | 'working' | 'you' | 'done';
const TAB_LABEL: Record<Tab, string> = { all: 'All', working: 'Working', you: 'Needs you', done: 'Done' };

/** Where a task stands, for the tabs and its chip. */
function standing(r: Run): Exclude<Tab, 'all'> | 'idle' {
  if (r.running) return 'working';
  const cur = currentStep(r);
  if (r.workflowStarted && !cur) return 'done';
  if (r.error || cur?.state === 'waiting') return 'you';
  return 'idle';
}

function whenGroup(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (d.getTime() >= today.getTime()) return 'Today';
  if (d.getTime() >= today.getTime() - day) return 'Yesterday';
  if (d.getTime() >= today.getTime() - 6 * day) return 'This week';
  return 'Earlier';
}

const whenLabel = (iso: string) => {
  const d = new Date(iso);
  return whenGroup(iso) === 'Today' ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Tasks, as AI Office's Sessions: the list (tabs, by day) and the open task's conversation. */
export default function TasksPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let wanted: string | null = null;
    let withAgent: string | null = null;
    try {
      wanted = sessionStorage.getItem(OPEN_TASK_KEY);
      withAgent = sessionStorage.getItem(NEW_TASK_AGENT_KEY);
      sessionStorage.removeItem(OPEN_TASK_KEY);
      sessionStorage.removeItem(NEW_TASK_AGENT_KEY);
    } catch {
      // opened without a wish
    }
    call('runsList')
      .then(async (r) => {
        setRuns(r);
        // An agent card's "Start a task": a new blank task with it.
        if (withAgent) {
          const t = await call('runsCreate', { ticket: { key: '', title: '', description: '', url: null }, agent: withAgent, draft: true });
          setRuns((rs) => [t, ...(rs ?? []).filter((x) => x.id !== t.id)]);
          setOpenId(t.id);
        } else if (wanted && r.some((x) => x.id === wanted)) setOpenId(wanted);
      })
      .catch((e) => setError((e as Error).message));
    return bridge().onRun((run) =>
      setRuns((rs) => {
        if (!rs) return rs;
        if ('deleted' in run) return rs.filter((r) => r.id !== run.id);
        const i = rs.findIndex((r) => r.id === run.id);
        return i < 0 ? [run, ...rs] : rs.map((r) => (r.id === run.id ? run : r));
      }),
    );
  }, []);

  const newTask = async () => {
    setError(null);
    try {
      const settings = await call('getSettings');
      const t = await call('runsCreate', { ticket: { key: '', title: '', description: '', url: null }, agent: settings.defaultAgent, draft: true });
      setRuns((rs) => [t, ...(rs ?? []).filter((x) => x.id !== t.id)]);
      setOpenId(t.id);
      setCollapsed(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: 0, working: 0, you: 0, done: 0 };
    for (const r of runs ?? []) {
      c.all++;
      const s = standing(r);
      if (s !== 'idle') c[s]++;
    }
    return c;
  }, [runs]);
  const visible = (runs ?? []).filter((r) => tab === 'all' || standing(r) === tab);
  const open = runs?.find((r) => r.id === openId) ?? null;

  return (
    <main className="aw-sessions-board">
      <section className="aw-panel aw-sessions" data-collapsed={collapsed || undefined} data-narrow={open ? true : undefined}>
        <header className="aw-panel-head">
          <button type="button" className="aw-icon-btn" onClick={() => setCollapsed(true)} aria-label="Hide tasks" title="Hide tasks">
            <PanelIcon size={15} />
          </button>
          <h1 className="aw-panel-title">Tasks</h1>
          <span className="aw-count">{runs?.length ?? 0}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="aw-btn aw-compact" data-primary onClick={() => void newTask()}>
            <AddIcon size={14} /> New task
          </button>
        </header>
        <div className="aw-sessions-tabs" role="tablist" aria-label="Show">
          {(Object.keys(TAB_LABEL) as Tab[]).map((k) => (
            <button key={k} type="button" role="tab" className="aw-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {TAB_LABEL[k]} <span className="aw-tab-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="aw-panel-body">
          {error && <p className="aw-error aw-pad">{error}</p>}
          <ul className="aw-session-list">
            {runs && visible.length === 0 && <li className="aw-muted aw-pad">{tab === 'all' ? 'No tasks yet — New task starts one.' : 'None in this tab.'}</li>}
            {visible.map((r, i) => {
              const g = whenGroup(r.createdAt);
              const head = i === 0 || whenGroup(visible[i - 1].createdAt) !== g;
              return (
                <Fragment key={r.id}>
                  {head && <li className="aw-sessions-group">{g}</li>}
                  <li>
                    <TaskCard run={r} active={r.id === openId} onOpen={() => setOpenId(r.id)} />
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      </section>

      {(open || collapsed) && (
        <section className="aw-panel aw-task-detail" data-full={collapsed || undefined}>
          {open ? (
            <TaskView key={open.id} run={open} onClose={() => setOpenId(null)} onDeleted={() => setOpenId(null)} />
          ) : (
            <div className="aw-empty">
              The task list is hidden.
              <button type="button" className="aw-btn aw-compact" onClick={() => setCollapsed(false)}>
                <PanelIcon size={14} /> Show tasks
              </button>
            </div>
          )}
          {open && collapsed && (
            <button type="button" className="aw-icon-btn aw-show-list" onClick={() => setCollapsed(false)} aria-label="Show tasks" title="Show tasks">
              <PanelIcon size={15} />
            </button>
          )}
        </section>
      )}
      {!open && !collapsed && runs && runs.length > 0 && (
        <section className="aw-panel aw-task-detail">
          <div className="aw-empty">
            <RunsIcon size={28} />
            Pick a task to see its conversation.
          </div>
        </section>
      )}
    </main>
  );
}

/** A task in the list, as a session card: its folder and when; its title, the last word in it; where it stands. */
function TaskCard({ run, active, onOpen }: { run: Run; active: boolean; onOpen: () => void }) {
  const s = standing(run);
  const cur = currentStep(run);
  const last = [...run.events].reverse().find((e) => e.kind === 'text' || e.kind === 'you');
  const where = run.source === 'repo' ? run.repo.split('/')[1] : run.source === 'folder' ? (run.folder ?? '').split(/[\\/]/).filter(Boolean).pop() : 'no folder';
  return (
    <button type="button" className="aw-card-task" data-active={active || undefined} data-standing={s} onClick={onOpen}>
      <span className="aw-card-meta">
        <span className="aw-claude-mark" aria-hidden="true">C</span>
        <span className="aw-dot-sep">·</span>
        <span className="aw-card-repo">{where}</span>
        {run.agent && (
          <>
            <span className="aw-dot-sep">·</span>
            <span className="aw-card-repo">{run.agent}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <span className="aw-card-when">{whenLabel(run.createdAt)}</span>
      </span>
      <span className="aw-card-title">
        {run.ticket.key && <span className="aw-mono aw-muted">{run.ticket.key} </span>}
        {run.ticket.title || 'New task'}
      </span>
      {last && <span className="aw-card-preview">{last.kind === 'you' ? 'You: ' : ''}{last.text}</span>}
      <span className="aw-card-chips">
        <span className="aw-pill" data-tone={s === 'working' ? 'info' : s === 'you' ? 'warn' : s === 'done' ? 'ok' : undefined}>
          {s === 'working' ? 'Working' : s === 'you' ? 'Needs you' : s === 'done' ? 'Done' : run.sessionId ? 'Idle' : 'Draft'}
        </span>
        {run.workflowStarted && cur && <span className="aw-pill">{cur.index + 1}. {STEP_LABELS[cur.index].short}</span>}
      </span>
    </button>
  );
}
