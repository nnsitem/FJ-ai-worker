'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinkOpener } from '@/components/LinkOpener';
import { call, type Run } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { RunWork } from '../tasks/RunWork';
import { STATE_TONE, STEP_LABELS } from '../tasks/steps';

const STATE_TEXT = { pending: '', running: 'Working', waiting: 'Your turn', done: 'Done', skipped: 'Skipped', failed: 'Failed' } as const;
const SSO = /https:\/\/github\.com\/\S+\/sso\S*/;

/**
 * A task's workflow, on the Workflow page (the task itself is the
 * conversation, on Tasks): its steps, the plan and its review, the fix, the
 * tests — and the way to start or rerun it.
 */
export function WorkflowDetail({ run }: { run: Run }) {
  const router = useRouter();
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
  const openTask = () => {
    try {
      sessionStorage.setItem(OPEN_TASK_KEY, run.id);
    } catch {
      // the Tasks page opens its first
    }
    router.push('/tasks');
  };
  const canStart = !run.running && (!run.workflowStarted || run.steps.analyze === 'failed');
  return (
    <>
      <header className="aw-panel-head">
        <div className="aw-panel-head-text">
          <h1 className="aw-panel-title">
            {t.key && <span className="aw-mono aw-muted">{t.key} </span>}
            {t.title || 'New task'}
          </h1>
          <p className="aw-panel-sub aw-mono">{run.source === 'repo' ? run.repo : run.source === 'folder' ? run.folder : 'No folder yet'}{run.branch && ` · ${run.branch}`}</p>
        </div>
        {canStart && (
          <button type="button" className="aw-btn aw-compact" data-primary onClick={() => void act(() => call(run.workflowStarted ? 'runsRerun' : 'runsStartWorkflow', run.id))}>
            ▶ {run.workflowStarted ? 'Run again' : 'Run workflow'}
          </button>
        )}
        {run.running && <button type="button" className="aw-btn aw-compact" onClick={() => void act(() => call('runsStop', run.id))}>Stop</button>}
        <button type="button" className="aw-btn aw-compact" onClick={openTask}>Open task</button>
      </header>
      <div className="aw-panel-body">
        <div className="aw-side-body">
          {(run.error || error) && (
            <div className="aw-side-cards" style={{ marginBottom: 12 }}>
              {run.error && <p className="aw-error">{run.error.replace(/:\s*https:\/\/\S+$/, '')}</p>}
              {run.error && SSO.test(run.error) && <LinkOpener url={SSO.exec(run.error)![0]} />}
              {error && <p className="aw-error">{error}</p>}
            </div>
          )}
          <WorkflowSide run={run} act={act} />
        </div>
      </div>
    </>
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
        <p className="aw-muted aw-small">Run workflow carries the task through these steps, in the task&apos;s own conversation. Each step&apos;s agent and model are the step settings above.</p>
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
