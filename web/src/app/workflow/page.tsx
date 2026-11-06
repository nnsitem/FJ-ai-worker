'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Panel } from '@/components/Panel';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { bridge, call, type Run, type Settings, type SettingsPatch, type StepId } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { currentStep, STATE_TONE, STEP_LABELS } from '../tasks/steps';

type Column = { id: StepId | 'chat' | 'finished'; label: string };

const COLUMNS: Column[] = [
  { id: 'chat', label: 'Not started' },
  ...STEP_LABELS.map((s, i) => ({ id: s.id, label: `${i + 1}. ${s.short}` })),
  { id: 'finished', label: 'Finished' },
];

const columnOf = (r: Run): Column['id'] => {
  if (!r.workflowStarted) return 'chat';
  return currentStep(r)?.id ?? 'finished';
};

const STATE_TEXT = { pending: 'Next', running: 'Working…', waiting: 'Your turn', done: 'Done', skipped: 'Skipped', failed: 'Needs you' } as const;

/**
 * The Workflow page, as AI Office's Agents Board: every task as a card in the
 * column of the step it's on, and above the board how the steps run —
 * each Claude step's agent and model, and which steps are on.
 */
export default function WorkflowPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const save = async (patch: SettingsPatch) => {
    setError(null);
    try {
      setSettings(await call('saveSettings', patch));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openTask = (id: string) => {
    try {
      sessionStorage.setItem(OPEN_TASK_KEY, id);
    } catch {
      // the Tasks page then opens its first
    }
    router.push('/tasks');
  };

  const wf = settings?.workflow;
  const inherit = { agent: 'Task’s agent', model: 'Task’s model' };

  return (
    <Panel
      title="Workflow"
      sub="Where every task is in the seven steps, and how the steps run"
      actions={
        <>
          {error && <span className="aw-error">{error}</span>}
          <button type="button" className="aw-btn" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            {showSettings ? 'Hide step settings' : 'Step settings'}
          </button>
        </>
      }
    >
      {showSettings && wf && (
        <div className="aw-wf-settings">
          <div className="aw-wf-step">
            <strong>1–2 Analyse &amp; plan</strong>
            <div className="aw-wf-pickers">
              <AgentModelPickers inheritLabel={inherit} agent={wf.analyse.agent} model={wf.analyse.model} onChange={(o) => void save({ workflow: { analyse: o } })} />
            </div>
          </div>
          <div className="aw-wf-step">
            <strong>3 Review the plan</strong>
            <label className="aw-check">
              <input type="checkbox" checked={wf.review.enabled} onChange={(e) => void save({ workflow: { review: { enabled: e.target.checked } } })} />
              <span>A person approves the plan <span className="aw-muted">— off: straight on to the fix (new tasks)</span></span>
            </label>
          </div>
          <div className="aw-wf-step">
            <strong>4 Fix</strong>
            <div className="aw-wf-pickers">
              <AgentModelPickers inheritLabel={inherit} agent={wf.fix.agent} model={wf.fix.model} onChange={(o) => void save({ workflow: { fix: o } })} />
            </div>
          </div>
          <div className="aw-wf-step">
            <strong>5 Automated tests</strong>
            <label className="aw-check">
              <input type="checkbox" checked={wf.test.enabled} onChange={(e) => void save({ workflow: { test: { enabled: e.target.checked } } })} />
              <span>Run tests after the fix</span>
            </label>
            <div className="aw-wf-pickers">
              <AgentModelPickers inheritLabel={inherit} agent={wf.test.agent} model={wf.test.model} disabled={!wf.test.enabled} onChange={(o) => void save({ workflow: { test: o } })} />
            </div>
            <div className="aw-row">
              <label className="aw-row aw-small">
                Rounds
                <input
                  className="aw-input aw-compact aw-rounds"
                  type="number"
                  min={1}
                  max={10}
                  value={wf.test.rounds}
                  disabled={!wf.test.enabled}
                  onChange={(e) => void save({ workflow: { test: { rounds: Number(e.target.value) || 1 } } })}
                />
              </label>
            </div>
            <small className="aw-muted">The agent tests only when a task has no test command.</small>
          </div>
          <div className="aw-wf-step aw-wf-later">
            <strong>6–7 Pull request &amp; human review</strong>
            <span className="aw-muted aw-small">Coming in M5.</span>
          </div>
        </div>
      )}

      <div className="aw-board">
        {COLUMNS.map((col) => {
          const cards = (runs ?? []).filter((r) => columnOf(r) === col.id);
          return (
            <section key={col.id} className="aw-board-col" data-col={col.id}>
              <header>
                <span>{col.label}</span>
                <span className="aw-count">{cards.length}</span>
              </header>
              <div className="aw-board-cards">
                {cards.map((r) => {
                  const cur = currentStep(r);
                  return (
                    <button key={r.id} type="button" className="aw-board-card" onClick={() => openTask(r.id)} data-running={r.running || undefined}>
                      <span className="aw-row-key">{r.ticket.key || 'Task'}</span>
                      <span className="aw-board-title">{r.ticket.title || r.ticket.description.slice(0, 80)}</span>
                      <span className="aw-board-meta">
                        {r.running ? (
                          <span className="aw-pill" data-tone="info">Working…</span>
                        ) : r.error ? (
                          <span className="aw-pill" data-tone="bad">Needs you</span>
                        ) : cur && r.workflowStarted ? (
                          <span className="aw-pill" data-tone={STATE_TONE[cur.state]}>{STATE_TEXT[cur.state]}</span>
                        ) : null}
                        <span className="aw-muted aw-small aw-board-where">{r.source === 'repo' ? r.repo : (r.folder ?? '').split(/[\\/]/).pop()}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
