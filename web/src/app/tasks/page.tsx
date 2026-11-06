'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ClaudeIcon, CloseIcon, CopilotIcon, EditIcon, PanelIcon, PipelineIcon, ToolIcon } from '@/components/icons';
import { bridge, call, type Run } from '@/lib/bridge';
import { NEW_TASK_AGENT_KEY, OPEN_TASK_KEY } from '@/lib/models';
import { OPEN_TASK_EVENT, takeParked } from '@/lib/open';
import { usePanelResize } from '@/lib/use-panel-resize';
import { TaskView } from './TaskView';
import { currentStep, placeName, standing, STEP_LABELS, type Standing } from './steps';

type Tab = 'all' | Exclude<Standing, 'idle'>;
const TAB_LABEL: Record<Tab, string> = { all: 'All', working: 'Working', you: 'Needs you', done: 'Done' };

/** The card's status, in AI Office's status set (globals.css --st-*): its stripe and chip. */
function status(r: Run): { key: string; label: string } {
  const s = standing(r);
  if (s === 'working') return { key: 'in_progress', label: 'Working' };
  if (s === 'done') return { key: 'done', label: 'Done' };
  if (s === 'you') return r.error ? { key: 'cancelled', label: 'Needs you' } : { key: 'hold', label: 'Needs you' };
  return r.sessionId ? { key: 'todo', label: 'Idle' } : { key: 'draft', label: 'Draft' };
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

/**
 * Tasks, laid out as AI Office's Sessions ((shell)/page.tsx): the list —
 * status tabs, grouped by day — and beside it the open task's conversation,
 * the divider between them dragged to resize.
 */
export default function TasksPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { boardRef, width: detailWidth, startResize, resetWidth } = usePanelResize(560);

  const select = useCallback(
    (id: string | null) => {
      setOpenId(id);
      setChangesOpen(false);
      // Every panel opens at its minimum, as in AI Office.
      if (id) resetWidth();
    },
    [resetWidth],
  );

  useEffect(() => {
    const wanted = takeParked(OPEN_TASK_KEY);
    const withAgent = takeParked(NEW_TASK_AGENT_KEY);
    call('runsList')
      .then(async (r) => {
        setRuns(r);
        // An agent card's "Start a task": a new blank task with it.
        if (withAgent) {
          const t = await call('runsCreate', { ticket: { key: '', title: '', description: '', url: null }, agent: withAgent, draft: true });
          setRuns((rs) => [t, ...(rs ?? []).filter((x) => x.id !== t.id)]);
          select(t.id);
        } else if (wanted && r.some((x) => x.id === wanted)) select(wanted);
      })
      .catch((e) => setError((e as Error).message));
    const off = bridge().onRun((run) =>
      setRuns((rs) => {
        if (!rs) return rs;
        if ('deleted' in run) return rs.filter((r) => r.id !== run.id);
        const i = rs.findIndex((r) => r.id === run.id);
        return i < 0 ? [run, ...rs] : rs.map((r) => (r.id === run.id ? run : r));
      }),
    );
    // A task asked for from elsewhere while this page shows (the top bar's
    // search or New task): read the list again — it may be newer — and open it.
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      takeParked(OPEN_TASK_KEY);
      call('runsList')
        .then((r) => {
          setRuns(r);
          if (r.some((x) => x.id === id)) {
            select(id);
            setCollapsed(false);
          }
        })
        .catch((err) => setError((err as Error).message));
    };
    window.addEventListener(OPEN_TASK_EVENT, onOpen);
    return () => {
      off();
      window.removeEventListener(OPEN_TASK_EVENT, onOpen);
    };
  }, [select]);

  // The right-click menu closes on any click elsewhere, or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

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

  const remove = async (r: Run) => {
    const what = r.source === 'repo' ? 'Its checkout goes too.' : 'Its folder stays.';
    if (!window.confirm(`Delete this task? ${what}`)) return;
    try {
      await call('runsDelete', r.id);
      if (openId === r.id) select(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async (id: string, title: string) => {
    setRenamingId(null);
    try {
      await call('runsSetTicket', id, { title });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const w = changesOpen ? Math.max(detailWidth, 680) : detailWidth;

  return (
    <main className="ao-board" ref={boardRef}>
      {/* Stays mounted when collapsed, so its width can animate shut. */}
      <section className="ao-panel ao-sessions" data-collapsed={collapsed} inert={collapsed}>
        <header className="ao-panel-head">
          <button type="button" className="ao-icon-btn ao-panel-toggle" onClick={() => setCollapsed(true)} aria-label="Hide tasks" title="Hide tasks">
            <PanelIcon size={15} />
          </button>
          <h2 className="ao-panel-title">Tasks</h2>
          <span className="ao-count">{runs?.length ?? 0}</span>
          <div className="ao-spacer" />
          <div className="ao-view-toggle ao-sessions-tabs" role="tablist" aria-label="Show">
            {(Object.keys(TAB_LABEL) as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" className="ao-view-btn" aria-selected={tab === k} data-active={tab === k} onClick={() => setTab(k)}>
                {TAB_LABEL[k]}
                <span className="ao-sessions-tab-count">{counts[k]}</span>
              </button>
            ))}
          </div>
        </header>

        {error && <p className="ao-task-panel-error ao-inset-note">{error}</p>}
        <ul className="ao-list">
          {runs && visible.length === 0 && (
            <li className="ao-column-empty">{tab !== 'all' ? 'None in this tab' : 'No tasks yet — New task, in the top bar, starts one.'}</li>
          )}
          {/* By when they started (the list's order, and the time on each card). */}
          {visible.map((r, i) => {
            const g = whenGroup(r.createdAt);
            const head = i === 0 || whenGroup(visible[i - 1].createdAt) !== g;
            return (
              <Fragment key={r.id}>
                {head && <li className="ao-sessions-group">{g}</li>}
                <li>
                  <TaskCard
                    run={r}
                    active={r.id === openId}
                    renaming={renamingId === r.id}
                    onOpen={() => select(r.id)}
                    onMenu={(x, y) => setMenu({ id: r.id, x, y })}
                    onRename={(title) => void rename(r.id, title)}
                    onCancelRename={() => setRenamingId(null)}
                  />
                </li>
              </Fragment>
            );
          })}
        </ul>
      </section>

      {open && !collapsed && <div className="ao-resizer" onMouseDown={startResize} />}
      {/* Not there until a card is picked: the list starts at full width. */}
      {(open || collapsed) && (
        <section
          className="ao-panel ao-detail"
          data-full={collapsed}
          data-changes-open={changesOpen}
          style={open ? { flexBasis: `${w}px`, ['--detail-w' as string]: `${w}px` } : undefined}
        >
          {open ? (
            <TaskView
              key={open.id}
              run={open}
              listHidden={collapsed}
              onShowList={() => setCollapsed(false)}
              changesOpen={changesOpen}
              onToggleChanges={() => setChangesOpen((v) => !v)}
              onClose={() => select(null)}
              onDelete={() => void remove(open)}
            />
          ) : (
            <div className="ao-detail-blank">
              <p className="ao-empty">The task list is hidden.</p>
              <button type="button" className="ao-btn-ghost" onClick={() => setCollapsed(false)}>
                <PanelIcon size={15} />
                Show tasks
              </button>
            </div>
          )}
        </section>
      )}

      {menu && (
        <div className="ao-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="ao-context-item"
            onClick={() => {
              setRenamingId(menu.id);
              setMenu(null);
            }}
          >
            <EditIcon size={13} />
            Rename
          </button>
          <button
            type="button"
            className="ao-context-item"
            data-danger
            onClick={() => {
              const r = runs?.find((x) => x.id === menu.id);
              setMenu(null);
              if (r) void remove(r);
            }}
          >
            <CloseIcon size={13} />
            Delete task
          </button>
        </div>
      )}
    </main>
  );
}

/** A task in the list, as AI Office's session card: Claude · where · agent and when; its title, the last word in it; its chips. */
function TaskCard({
  run,
  active,
  renaming,
  onOpen,
  onMenu,
  onRename,
  onCancelRename,
}: {
  run: Run;
  active: boolean;
  renaming: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const st = status(run);
  const cur = currentStep(run);
  const last = [...run.events].reverse().find((e) => e.kind === 'text' || e.kind === 'you');
  const tools = run.events.filter((e) => e.kind === 'tool').length;
  return (
    <div
      className="ao-card"
      role="button"
      tabIndex={0}
      data-status={st.key}
      data-active={active}
      onClick={() => !renaming && onOpen()}
      onKeyDown={(e) => {
        if (renaming || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title="Right-click to rename or delete"
    >
      <div className="ao-card-meta">
        <span className="ao-card-src">
          <span className="ao-agent-mark" title={run.engine === 'copilot' ? 'GitHub Copilot' : 'Claude'} aria-label={run.engine === 'copilot' ? 'GitHub Copilot' : 'Claude'}>
            {run.engine === 'copilot' ? <CopilotIcon size={14} /> : <ClaudeIcon size={14} />}
          </span>
          <span className="ao-dot-sep">·</span>
          <span className="ao-card-repo">{placeName(run)}</span>
          {run.agent && (
            <>
              <span className="ao-dot-sep">·</span>
              <span className="ao-card-repo">{run.agent}</span>
            </>
          )}
        </span>
        <span className="ao-card-when">{whenLabel(run.createdAt)}</span>
      </div>

      {renaming ? (
        <input
          className="ao-card-title-input"
          defaultValue={run.ticket.title}
          autoFocus
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') onCancelRename();
          }}
          onBlur={(e) => onRename(e.target.value)}
        />
      ) : (
        <p className="ao-card-title">
          {run.ticket.key && <span className="ao-card-key">{run.ticket.key} </span>}
          {run.ticket.title || 'New task'}
        </p>
      )}
      {last && (
        <p className="ao-card-preview">
          {last.kind === 'you' ? 'You: ' : ''}
          {last.text}
        </p>
      )}

      <div className="ao-card-chips">
        <span className="ao-chip ao-chip-status" data-status={st.key}>
          {st.label}
        </span>
        {run.workflowStarted && (
          <span className="ao-chip ao-step-chip" data-step={cur ? STEP_LABELS[cur.index].id : 'finished'} title="Where its workflow is">
            <PipelineIcon size={11} />
            {cur ? `${STEP_LABELS[cur.index].n}. ${STEP_LABELS[cur.index].short}` : 'Finished'}
          </span>
        )}
        {tools > 0 && (
          <span className="ao-chip ao-chip-tool" title="Tool calls">
            <ToolIcon size={11} />
            {tools}
          </span>
        )}
      </div>
    </div>
  );
}
