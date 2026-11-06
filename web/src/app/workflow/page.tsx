'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { AgentsIcon, CloseIcon, PlayIcon, SearchIcon, SlidersIcon } from '@/components/icons';
import { bridge, call, type Run, type Settings, type SettingsPatch, type StepId } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { openTask, takeParked } from '@/lib/open';
import { usePanelResize } from '@/lib/use-panel-resize';
import { inPopupLayer } from '@/lib/popup-layer';
import { currentStep, placeName, STEP_LABELS } from '../tasks/steps';
import { WorkflowDetail } from './WorkflowDetail';
import { Minimap } from './Minimap';

type ColumnId = StepId | 'chat' | 'finished';

const COLUMNS: { id: ColumnId; label: string; short: string; hint: string }[] = [
  { id: 'chat', label: 'Not started', short: 'Not started', hint: 'Tasks still in conversation — Run workflow carries one through the steps' },
  ...STEP_LABELS.map((s) => ({ id: s.id as ColumnId, label: `${s.n}. ${s.short}`, short: `${s.n} ${s.short}`, hint: s.manual ? `${s.label} — then ${s.manual}` : s.label })),
  { id: 'finished', label: 'Finished', short: 'Done', hint: 'Through every step' },
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

        {runs && runs.length > 0 && (
          <Minimap
            columns={COLUMNS}
            runs={visible}
            columnOf={columnOf}
            selected={selected}
            onPick={(id) => {
              openPanel(id);
              setTimeout(() => document.querySelector(`[data-run="${id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 50);
            }}
          />
        )}
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

/** What a card waiting on the person asks of them, by step. */
const WAITING_TEXT: Partial<Record<StepId, { text: string; label: string }>> = {
  review: { text: 'The plan is ready — review it', label: 'Review' },
  test: { text: 'The tests need you — another round, or go on', label: 'Open' },
  selfReview: { text: 'The AI review still asks for changes', label: 'Open' },
  pr: { text: 'Ready to push and open the PR — your go', label: 'Open' },
  humanReview: { text: 'Waiting for reviewers on GitHub', label: 'Open' },
};

/** A task on the board, as AI Office's Agents Board card. */
function CardView({ run, column, active, onOpen, onOpenTask, onStart }: { run: Run; column: ColumnId; active: boolean; onOpen: () => void; onOpenTask: () => void; onStart: () => void }) {
  const chip = stateChip(run);
  const subs = run.agents.filter((a) => a.status === 'running').length;
  const last = [...run.events].reverse().find((e) => e.kind === 'tool' || e.kind === 'text');
  const cur = currentStep(run);
  // On your turn: what to do next, and the button for it.
  const next =
    run.running || !run.workflowStarted
      ? null
      : run.error
        ? { text: 'Stopped — see what went wrong', label: 'Open' }
        : cur?.state === 'waiting'
          ? (WAITING_TEXT[cur.id] ?? { text: 'Waiting for you', label: 'Open' })
          : cur?.state === 'failed'
            ? { text: 'Stopped — see what it needs', label: 'Open' }
            : null;
  return (
    <div
      className="ao-card ao-pipe-card"
      data-step={column}
      data-run={run.id}
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
        {subs > 0 && (
          <span className="ao-pipe-state" data-tone="running" title={`${subs} subagent${subs === 1 ? '' : 's'} working`}>
            <AgentsIcon size={11} /> {subs}
          </span>
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
          <header className="ao-wf-head">
            <strong>How the workflow runs</strong>
            <span>For tasks from now on. A step with no agent or model of its own uses the task&apos;s.</span>
          </header>
          <ol className="ao-wf-steps">
            <StepRow n="1–2" name="Analyse & plan" who="Claude">
              <div className="ao-wf-pickers">
                <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.analyse.agent} model={wf.analyse.model} onChange={(o) => void onSave({ workflow: { analyse: o } })} />
              </div>
            </StepRow>
            <StepRow
              n="3"
              name="Review the plan"
              who="You"
              toggle={{ on: wf.review.enabled, label: 'Required', set: (on) => void onSave({ workflow: { review: { enabled: on } } }) }}
              note={wf.review.enabled ? 'You approve the plan, ask for changes, or skip.' : 'Off: the plan goes straight on to the fix.'}
            />
            <StepRow n="4" name="Fix" who="Claude">
              <div className="ao-wf-pickers">
                <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.fix.agent} model={wf.fix.model} onChange={(o) => void onSave({ workflow: { fix: o } })} />
              </div>
            </StepRow>
            <StepRow
              n="5"
              name="Automated tests"
              who="Claude"
              toggle={{ on: wf.test.enabled, label: 'On', set: (on) => void onSave({ workflow: { test: { enabled: on } } }) }}
              note={wf.test.enabled ? 'A task’s test command runs if it has one; otherwise this agent runs the tests.' : 'Off: straight on to the pull request.'}
            >
              {wf.test.enabled && (
                <>
                  <div className="ao-wf-pickers">
                    <AgentModelPickers placement="down-start" inheritLabel={inherit} agent={wf.test.agent} model={wf.test.model} onChange={(o) => void onSave({ workflow: { test: o } })} />
                  </div>
                  <label className="ao-wf-switch-line">
                    <Switch on={wf.test.baseline} onChange={(on) => void onSave({ workflow: { test: { baseline: on } } })} label="Baseline on the base first" />
                    <span>Run them on the base first, so failures already there aren&apos;t blamed on the change</span>
                  </label>
                  <label className="ao-wf-rounds">
                    <span>Fix-and-test rounds before it stops for you</span>
                    <input
                      className="ao-task-input"
                      type="number"
                      min={1}
                      max={10}
                      value={wf.test.rounds}
                      onChange={(e) => void onSave({ workflow: { test: { rounds: Number(e.target.value) || 1 } } })}
                    />
                  </label>
                </>
              )}
            </StepRow>
            <StepRow
              n="5½"
              name="AI review of the diff"
              who="Claude"
              toggle={{ on: wf.selfReview.enabled, label: 'On', set: (on) => void onSave({ workflow: { selfReview: { enabled: on } } }) }}
              note={
                wf.selfReview.enabled
                  ? 'A fresh Claude reads the change against the ticket and plan; files the plan didn’t name and secrets are flagged. Its findings go back to the fix.'
                  : 'Off: straight on to the pull request.'
              }
            >
              {wf.selfReview.enabled && (
                <>
                  <div className="ao-wf-pickers">
                    <AgentModelPickers
                      placement="down-start"
                      inheritLabel={{ agent: 'Built-in reviewer', model: 'Task’s model' }}
                      agent={wf.selfReview.agent}
                      model={wf.selfReview.model}
                      onChange={(o) => void onSave({ workflow: { selfReview: o } })}
                    />
                  </div>
                  <label className="ao-wf-rounds">
                    <span>Review-and-fix rounds before it stops for you</span>
                    <input
                      className="ao-task-input"
                      type="number"
                      min={1}
                      max={5}
                      value={wf.selfReview.rounds}
                      onChange={(e) => void onSave({ workflow: { selfReview: { rounds: Number(e.target.value) || 1 } } })}
                    />
                  </label>
                </>
              )}
            </StepRow>
            <StepRow
              n="6"
              name="Pull request"
              who="App"
              toggle={{ on: wf.pr.confirm, label: 'Ask first', set: (on) => void onSave({ workflow: { pr: { confirm: on } } }) }}
              note={wf.pr.confirm ? 'Waits for your go before pushing to the company’s GitHub.' : 'Pushes and opens the PR as soon as the tests pass.'}
            >
              <label className="ao-wf-switch-line">
                <Switch on={wf.pr.draft} onChange={(on) => void onSave({ workflow: { pr: { draft: on } } })} label="Open as a draft" />
                <span>Open as a draft</span>
              </label>
            </StepRow>
            <StepRow n="7" name="Human review" who="You" note="Reviewers on GitHub; their comments can go back to Claude. FJ AI Worker never merges." />
          </ol>
          <p className="ao-pipe-menu-note">Agents come from Agents &amp; skills.</p>
        </div>
      )}
    </div>
  );
}

/** One step in Step settings: its number, name and who does it; a switch if it can be off; its settings under it. */
function StepRow({
  n,
  name,
  who,
  toggle,
  note,
  children,
}: {
  n: string;
  name: string;
  who: 'Claude' | 'You' | 'App';
  toggle?: { on: boolean; label: string; set: (on: boolean) => void };
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="ao-wf-step" data-off={toggle && !toggle.on ? true : undefined}>
      <span className="ao-wf-step-n">{n}</span>
      <div className="ao-wf-step-body">
        <div className="ao-wf-step-head">
          <span className="ao-wf-step-name">{name}</span>
          <span className="ao-wf-who" data-who={who}>{who}</span>
          <span style={{ flex: 1 }} />
          {toggle && (
            <label className="ao-wf-switch-line">
              <span>{toggle.label}</span>
              <Switch on={toggle.on} onChange={toggle.set} label={`${name}: ${toggle.label}`} />
            </label>
          )}
        </div>
        {note && <p className="ao-wf-step-note">{note}</p>}
        {children}
      </div>
    </li>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="ao-switch" data-on={on || undefined} onClick={() => onChange(!on)} />;
}
