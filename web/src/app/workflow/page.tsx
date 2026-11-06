'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { CloseIcon, PlayIcon, SearchIcon, SlidersIcon } from '@/components/icons';
import { bridge, call, type Run, type Settings, type SettingsPatch, type StepId } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { openTask, takeParked } from '@/lib/open';
import { usePanelResize } from '@/lib/use-panel-resize';
import { inPopupLayer } from '@/lib/popup-layer';
import { currentStep, placeName, STEP_LABELS } from '../tasks/steps';
import { WorkflowDetail } from './WorkflowDetail';

type ColumnId = StepId | 'chat' | 'finished';

const COLUMNS: { id: ColumnId; label: string; hint: string }[] = [
  { id: 'chat', label: 'Not started', hint: 'Tasks still in conversation — Run workflow carries one through the steps' },
  ...STEP_LABELS.map((s, i) => ({ id: s.id as ColumnId, label: `${i + 1}. ${s.short}`, hint: s.manual ? `${s.label} — then ${s.manual}` : s.label })),
  { id: 'finished', label: 'Finished', hint: 'Through every step' },
];

const columnOf = (r: Run): ColumnId => (!r.workflowStarted ? 'chat' : (currentStep(r)?.id ?? 'finished'));

// Must match the slide-out on .ao-task-panel[data-closing] (team.css).
const PANEL_CLOSE_MS = 220;

/** What a card's state says, as AI Office's state chip. */
function stateChip(r: Run): { label: string; tone: string } | null {
  if (r.running) return { label: 'Working…', tone: 'running' };
  if (r.error) return { label: 'Needs you', tone: 'failed' };
  if (!r.workflowStarted) return null;
  const cur = currentStep(r);
  if (!cur) return { label: 'Done', tone: 'passed' };
  if (cur.state === 'waiting') return { label: 'Your turn', tone: 'idle' };
  if (cur.state === 'failed') return { label: 'Needs you', tone: 'failed' };
  return { label: 'Next', tone: 'ready' };
}

/**
 * The Workflow page, as AI Office's Agents Board: every task as a card in the
 * column of the step it's on; the step settings behind the sliders button
 * (AI Office's StageSettings); a card opens its workflow in the side panel
 * (AI Office's CardPanel).
 */
export default function WorkflowPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const { boardRef, width: panelWidth, startResize, resetWidth } = usePanelResize();

  useEffect(() => {
    call('runsList').then(setRuns).catch((e) => setError((e as Error).message));
    call('getSettings').then(setSettings).catch(() => {});
    return bridge().onRun((run) =>
      setRuns((rs) => {
        if (!rs) return rs;
        if ('deleted' in run) return rs.filter((r) => r.id !== run.id);
        const i = rs.findIndex((r) => r.id === run.id);
        return i < 0 ? [run, ...rs] : rs.map((r) => (r.id === run.id ? run : r));
      }),
    );
  }, []);

  const openPanel = useCallback(
    (id: string) => {
      window.clearTimeout(closeTimer.current);
      setClosing(false);
      setSelected((cur) => {
        if (cur !== id) resetWidth();
        return id;
      });
    },
    [resetWidth],
  );
  const closePanel = () => {
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setSelected(null);
      setClosing(false);
    }, PANEL_CLOSE_MS);
  };

  // Sent here from a task: that task's card open.
  useEffect(() => {
    const want = takeParked(OPEN_TASK_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the page that sent us here
    if (want) openPanel(want);
  }, [openPanel]);

  const save = async (patch: SettingsPatch) => {
    setError(null);
    try {
      setSettings(await call('saveSettings', patch));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (runs ?? []).filter((r) => !q || `${r.ticket.key} ${r.ticket.title} ${r.repo} ${r.folder ?? ''}`.toLowerCase().includes(q));
  const yourTurn = visible.filter((r) => !r.running && r.workflowStarted && (r.error || currentStep(r)?.state === 'waiting')).length;
  const open = runs?.find((r) => r.id === selected) ?? null;

  return (
    <main className="ao-board" ref={boardRef}>
      <section className="ao-panel ao-sessions ao-pipe">
        <header className="ao-panel-head">
          <h2 className="ao-panel-title">Workflow</h2>
          <span className="ao-count">{visible.length}</span>
          {yourTurn > 0 && <span className="ao-pipe-yourturn">{yourTurn} waiting for you</span>}
          {error && (
            <span className="ao-task-panel-error ao-head-error" title={error}>
              {error}
            </span>
          )}
          <div className="ao-team-filters">
            <div className="ao-search-field ao-team-search">
              <SearchIcon size={14} />
              <input className="ao-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…" aria-label="Search tasks" />
              {query && (
                <button type="button" className="ao-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                  <CloseIcon size={13} />
                </button>
              )}
            </div>
            {settings && <StepSettings settings={settings} onSave={save} />}
          </div>
        </header>

        <div className="ao-columns ao-pipe-columns ao-wf-columns">
          {COLUMNS.map((col) => {
            const list = visible.filter((r) => columnOf(r) === col.id);
            return (
              <div className="ao-column" key={col.id} data-col={col.id}>
                <div className="ao-column-head" title={col.hint}>
                  <span className="ao-column-dot" data-step={col.id} />
                  <span className="ao-column-title">{col.label}</span>
                  <span className="ao-count">{runs ? list.length : 0}</span>
                </div>
                <ul className="ao-card-list">
                  {runs && list.length === 0 && <li className="ao-column-empty">No tasks</li>}
                  {list.map((r) => (
                    <li key={r.id}>
                      <CardView
                        run={r}
                        column={col.id}
                        active={r.id === selected && !closing}
                        onOpen={() => (r.id === selected && !closing ? closePanel() : openPanel(r.id))}
                        onOpenTask={() => openTask(r.id, router)}
                        onStart={() => void call('runsStartWorkflow', r.id).catch((e) => setError((e as Error).message))}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {open && (
        <>
          {!closing && <div className="ao-resizer" onMouseDown={startResize} />}
          <section className="ao-panel ao-detail ao-task-panel ao-pipe-panel" data-closing={closing || undefined} style={{ flexBasis: `${panelWidth}px` }} aria-label={open.ticket.title}>
            <div className="ao-task-panel-inner" style={{ width: `${panelWidth}px` }}>
              <WorkflowDetail key={open.id} run={open} onClose={closePanel} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}

/** A task on the board, as AI Office's Agents Board card. */
function CardView({ run, column, active, onOpen, onOpenTask, onStart }: { run: Run; column: ColumnId; active: boolean; onOpen: () => void; onOpenTask: () => void; onStart: () => void }) {
  const chip = stateChip(run);
  const last = [...run.events].reverse().find((e) => e.kind === 'tool' || e.kind === 'text');
  const cur = currentStep(run);
  // On your turn: what to do next, and the button for it.
  const next =
    run.running || !run.workflowStarted
      ? null
      : cur?.id === 'review' && cur.state === 'waiting'
        ? { text: 'The plan is ready — review it', label: 'Review' }
        : cur?.state === 'waiting' || cur?.state === 'failed' || run.error
          ? { text: 'Claude stopped — see what it needs', label: 'Open' }
          : null;
  return (
    <div
      className="ao-card ao-pipe-card"
      data-step={column}
      data-active={active}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${run.ticket.title || 'the task'}`}
    >
      <div className="ao-pipe-card-top">
        {run.ticket.key ? (
          <span className="ao-team-tag" data-kind="project">
            {run.ticket.key}
          </span>
        ) : (
          <span className="ao-pipe-local">Task</span>
        )}
        {chip && (
          <span className="ao-pipe-state" data-tone={chip.tone}>
            {chip.tone === 'running' && <span className="ao-pipe-pulse" />}
            {chip.label}
          </span>
        )}
      </div>
      <p className="ao-team-card-title">{run.ticket.title || run.ticket.description.slice(0, 80) || 'New task'}</p>
      {run.running && last ? (
        <p className="ao-pipe-activity">
          <span>{last.text}</span>
        </p>
      ) : (
        <p className="ao-pipe-note">
          {placeName(run)}
          {run.agent ? ` · ${run.agent}` : ''}
        </p>
      )}
      {column === 'chat' && !run.running && run.source !== 'none' && (
        <button
          type="button"
          className="ao-btn-primary ao-btn-compact ao-pipe-start"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
        >
          <PlayIcon size={13} /> Run workflow
        </button>
      )}
      {next && (
        // Its own keys: Enter on its button mustn't open the card's panel.
        <div className="ao-pipe-next" onKeyDown={(e) => e.stopPropagation()}>
          <span>{next.text}</span>
          <button
            type="button"
            className="ao-btn-secondary ao-btn-compact"
            onClick={(e) => {
              e.stopPropagation();
              if (next.label === 'Review') onOpen();
              else onOpenTask();
            }}
          >
            {next.label}
          </button>
        </div>
      )}
    </div>
  );
}

/** How the steps run — AI Office's StageSettings popover: each Claude step's agent and model, and which steps are on. */
function StepSettings({ settings, onSave }: { settings: Settings; onSave: (p: SettingsPatch) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node) && !inPopupLayer(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const wf = settings.workflow;
  const inherit = { agent: 'Task’s agent', model: 'Task’s model' };

  return (
    <div className="ao-pipe-settings" ref={rootRef}>
      <button
        type="button"
        className="ao-btn-secondary ao-btn-compact"
        data-active={open || undefined}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Which agent and model each step runs, and which steps are on"
      >
        <SlidersIcon size={14} />
        Step settings
      </button>
      {open && (
        <div className="ao-pipe-menu ao-wf-settings" role="dialog" aria-label="Step settings">
          <div className="ao-pipe-setting">
            <span>1–2 Analyse &amp; plan</span>
            <div className="ao-wf-pickers">
              <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.analyse.agent} model={wf.analyse.model} onChange={(o) => void onSave({ workflow: { analyse: o } })} />
            </div>
          </div>
          <label className="ao-pipe-check">
            <input type="checkbox" checked={wf.review.enabled} onChange={(e) => void onSave({ workflow: { review: { enabled: e.target.checked } } })} />
            <span>
              3 · A person reviews the plan
              <small>Off: straight on to the fix (new tasks).</small>
            </span>
          </label>
          <div className="ao-pipe-setting">
            <span>4 Fix</span>
            <div className="ao-wf-pickers">
              <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.fix.agent} model={wf.fix.model} onChange={(o) => void onSave({ workflow: { fix: o } })} />
            </div>
          </div>
          <label className="ao-pipe-check">
            <input type="checkbox" checked={wf.test.enabled} onChange={(e) => void onSave({ workflow: { test: { enabled: e.target.checked } } })} />
            <span>
              5 · Run tests after the fix
              <small>The agent tests only when a task has no test command.</small>
            </span>
          </label>
          <div className="ao-pipe-setting">
            <span>5 Automated tests</span>
            <div className="ao-wf-pickers">
              <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.test.agent} model={wf.test.model} disabled={!wf.test.enabled} onChange={(o) => void onSave({ workflow: { test: o } })} />
            </div>
            <label className="ao-wf-rounds">
              Rounds
              <input
                className="ao-task-input"
                type="number"
                min={1}
                max={10}
                value={wf.test.rounds}
                disabled={!wf.test.enabled}
                onChange={(e) => void onSave({ workflow: { test: { rounds: Number(e.target.value) || 1 } } })}
              />
            </label>
          </div>
          <p className="ao-pipe-menu-note">6–7 Pull request &amp; human review — coming in M5. Agents come from the Agents &amp; skills page.</p>
        </div>
      )}
    </div>
  );
}
