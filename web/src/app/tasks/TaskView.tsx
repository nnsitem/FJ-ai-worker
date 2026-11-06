'use client';

import { useState } from 'react';
import { LinkOpener } from '@/components/LinkOpener';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { call, type Run } from '@/lib/bridge';
import { Conversation } from './Conversation';
import { ChangesCard, RunWork } from './RunWork';
import { STATE_TONE, STEP_LABELS } from './steps';

const STATE_TEXT = { pending: '', running: 'Working', waiting: 'Your turn', done: 'Done', skipped: 'Skipped', failed: 'Failed' } as const;
const SSO = /https:\/\/github\.com\/\S+\/sso\S*/;

/**
 * One task, as AI Office's sessions: where it works, its agent and model,
 * the conversation with Claude; beside it, the workflow's steps (plan,
 * review, fix, tests) and what changed.
 */
export function TaskView({ run, onDeleted }: { run: Run; onDeleted: () => void }) {
  const [side, setSide] = useState<'workflow' | 'changes'>('workflow');
  const [sideShown, setSideShown] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = run.ticket;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const where = run.source === 'repo' ? `${run.repo}${run.baseBranch ? `@${run.baseBranch}` : ''}` : (run.folder ?? '');
  const canStart = !run.running && (!run.workflowStarted || run.steps.analyze === 'failed');

  return (
    <div className="aw-task">
      <header className="aw-task-head">
        <div className="aw-task-title">
          <h2>
            {t.key && <span className="aw-mono aw-muted">{t.key} </span>}
            {t.title || t.key}
          </h2>
          <span className="aw-task-where aw-mono" title={where}>
            {run.source === 'repo' ? '⎇ ' : '📁 '}
            {where}
            {run.branch && <> · {run.branch}</>}
          </span>
        </div>
        <div className="aw-row aw-task-tools">
          <AgentModelPickers agent={run.agent} model={run.model} disabled={run.running} onChange={(o) => void act(() => call('runsSetOptions', run.id, o))} />
          <button type="button" className="aw-btn aw-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'vscode'))}>VS Code</button>
          <button type="button" className="aw-btn aw-compact" aria-pressed={sideShown} onClick={() => setSideShown((v) => !v)} title="Show or hide the Workflow and Changes panel">
            {sideShown ? 'Hide panel' : 'Workflow & changes'}
          </button>
          {t.url && <button type="button" className="aw-btn aw-compact" onClick={() => void call('openExternal', t.url!)}>Jira</button>}
          <button
            type="button"
            className="aw-btn aw-compact"
            data-danger
            onClick={() => {
              const what = run.source === 'repo' ? 'Its checkout goes too.' : 'The folder itself stays.';
              if (window.confirm(`Delete this task? ${what}`)) void act(async () => (await call('runsDelete', run.id), onDeleted()));
            }}
          >
            Delete
          </button>
        </div>
      </header>

      <div className="aw-strip">
        <ol className="aw-strip-steps">
          {STEP_LABELS.map((s, i) => {
            const state = run.steps[s.id];
            return (
              <li key={s.id} className="aw-strip-step" data-state={state} title={`${s.label}${s.manual ? ` — ${s.manual}` : ''}${state !== 'pending' ? ` · ${STATE_TEXT[state]}` : ''}`}>
                <span className="aw-strip-n">{i + 1}</span>
                <span className="aw-strip-label">{s.short}</span>
              </li>
            );
          })}
        </ol>
        {canStart && (
          <button type="button" className="aw-btn" data-primary onClick={() => void act(() => call(run.workflowStarted ? 'runsRerun' : 'runsStartWorkflow', run.id))}>
            ▶ {run.workflowStarted ? 'Run again' : 'Run workflow'}
          </button>
        )}
      </div>

      {(run.error || error) && (
        <div className="aw-task-errors">
          {run.error && <p className="aw-error">{run.error.replace(/:\s*https:\/\/\S+$/, '')}</p>}
          {/* GitHub's SSO authorisation link: opened where the company sign-in is. */}
          {run.error && SSO.test(run.error) && <LinkOpener url={SSO.exec(run.error)![0]} />}
          {error && <p className="aw-error">{error}</p>}
        </div>
      )}

      <div className="aw-task-body" data-side={sideShown ? undefined : 'hidden'}>
        <Conversation run={run} />
        <aside className="aw-task-side">
          <div className="aw-tabs aw-side-tabs" role="tablist">
            <button type="button" role="tab" className="aw-tab" aria-selected={side === 'workflow'} onClick={() => setSide('workflow')}>Workflow</button>
            <button type="button" role="tab" className="aw-tab" aria-selected={side === 'changes'} onClick={() => setSide('changes')}>Changes</button>
          </div>
          <div className="aw-side-body">
            {side === 'workflow' ? <WorkflowSide run={run} act={act} /> : <ChangesCard run={run} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Steps 1–5 as cards: the plan (copy to Jira), its review, the fix and the tests. */
function WorkflowSide({ run, act }: { run: Run; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = run.ticket;

  if (!run.workflowStarted)
    return (
      <div className="aw-side-empty">
        <ol className="aw-steps">
          {STEP_LABELS.map((s, i) => (
            <li key={s.id} className="aw-step">
              <span className="aw-step-n">{i + 1}</span>
              <span className="aw-step-label">
                {s.label}
                {s.manual && <small> — {s.manual}</small>}
              </span>
            </li>
          ))}
        </ol>
        <p className="aw-muted aw-small">Run workflow to carry the task through these steps. Each step&apos;s agent and model are set on the Workflow page.</p>
      </div>
    );

  const copyPlan = async () => {
    if (!run.plan) return;
    await navigator.clipboard.writeText(`FJ AI Worker plan${t.key ? ` for ${t.key}` : ''}\n\n${run.plan}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="aw-side-cards">
      <ol className="aw-steps">
        {STEP_LABELS.map((s, i) => {
          const state = run.steps[s.id];
          return (
            <li key={s.id} className="aw-step" data-state={state}>
              <span className="aw-step-n">{i + 1}</span>
              <span className="aw-step-label">{s.label}</span>
              {state !== 'pending' && <span className="aw-pill" data-tone={STATE_TONE[state]}>{STATE_TEXT[state]}</span>}
            </li>
          );
        })}
      </ol>

      {run.plan && (
        <section className="aw-card aw-plan">
          <div className="aw-card-head">
            <h2>Plan{run.revisions.length > 0 && <span className="aw-muted"> · rev {run.revisions.length + 1}</span>}</h2>
            <button type="button" className="aw-btn aw-compact" onClick={copyPlan}>{copied ? 'Copied' : 'Copy for Jira'}</button>
          </div>
          <div className="aw-prose">{run.plan}</div>
          <label className="aw-check">
            <input type="checkbox" checked={run.planInTicket} onChange={(e) => void act(() => call('runsPlanInTicket', run.id, e.target.checked))} />
            <span>Added to {t.key || 'the ticket'} in Jira <span className="aw-muted">— by hand for now</span></span>
          </label>
        </section>
      )}

      {run.steps.review === 'waiting' && !run.running && (
        <section className="aw-card aw-review">
          <div className="aw-card-head"><h2>Step 3 — review the plan</h2></div>
          {asking ? (
            <>
              <textarea className="aw-textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change in the plan?" autoFocus />
              <div className="aw-row">
                <button
                  type="button"
                  className="aw-btn"
                  data-primary
                  disabled={!feedback.trim()}
                  onClick={() =>
                    act(async () => {
                      await call('runsReview', run.id, { kind: 'changes', feedback });
                      setFeedback('');
                      setAsking(false);
                    })
                  }
                >
                  Send to Claude
                </button>
                <button type="button" className="aw-btn" onClick={() => setAsking(false)}>Back</button>
              </div>
            </>
          ) : (
            <div className="aw-row">
              <button type="button" className="aw-btn" data-primary onClick={() => act(() => call('runsReview', run.id, { kind: 'approve' }))}>Approve</button>
              <button type="button" className="aw-btn" onClick={() => setAsking(true)}>Ask for changes</button>
              <button type="button" className="aw-btn" onClick={() => act(() => call('runsReview', run.id, { kind: 'skip' }))}>Skip</button>
            </div>
          )}
        </section>
      )}

      <RunWork run={run} act={act} />
    </div>
  );
}
