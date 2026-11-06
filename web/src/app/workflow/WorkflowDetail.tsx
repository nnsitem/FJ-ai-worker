'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinkOpener } from '@/components/LinkOpener';
import { BoardIcon, CloseIcon, PlayIcon } from '@/components/icons';
import { call, type Run } from '@/lib/bridge';
import { Markdown } from '@/lib/markdown';
import { openTask } from '@/lib/open';
import { RunWork } from '../tasks/RunWork';
import { currentStep, STEP_LABELS } from '../tasks/steps';

const SSO = /https:\/\/github\.com\/\S+\/sso\S*/;

/**
 * A task's workflow, in the Workflow page's side panel — AI Office's CardPanel
 * (agents-board/panels.tsx): where it stands on the steps, a note on what
 * it's doing, then the plan and its review, the fix and the tests; the way
 * to start or rerun it at the foot.
 */
export function WorkflowDetail({ run, onClose }: { run: Run; onClose: () => void }) {
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
  const canStart = !run.running && (!run.workflowStarted || run.steps.analyze === 'failed');
  const cur = currentStep(run);
  const last = [...run.events].reverse().find((e) => e.kind === 'tool' || e.kind === 'text' || e.kind === 'system');

  return (
    <>
      <header className="ao-task-panel-head">
        <div className="ao-task-panel-heading">
          <div className="ao-task-panel-meta">
            {t.key && (
              <span className="ao-team-tag" data-kind="project">
                {t.key}
              </span>
            )}
            <span className="ao-task-panel-id">
              {run.source === 'repo' ? run.repo : run.source === 'folder' ? run.folder : 'No folder yet'}
              {run.branch && ` · ${run.branch}`}
            </span>
          </div>
          <h2 className="ao-task-panel-title">{t.title || 'New task'}</h2>
        </div>
        <button type="button" className="ao-icon-btn" onClick={onClose} aria-label="Close panel" title="Close">
          <CloseIcon size={15} />
        </button>
      </header>

      <div className="ao-task-panel-body">
        <ol className="ao-pipe-steps ao-wf-steps" aria-label="Progress">
          {STEP_LABELS.map((s, i) => {
            const state = run.steps[s.id];
            const shown = !run.workflowStarted
              ? 'next'
              : state === 'done' || state === 'skipped'
                ? 'past'
                : i === cur?.index
                  ? state === 'waiting' || state === 'failed'
                    ? 'waiting'
                    : 'current'
                  : 'next';
            return (
              <li key={s.id} data-state={shown} title={`${s.label}${s.manual ? ` — then ${s.manual}` : ''}${state === 'skipped' ? ' (skipped)' : ''}`}>
                <span className="ao-pipe-step-dot" />
                {s.short.split(' ')[0]}
              </li>
            );
          })}
        </ol>

        {(run.running || run.error || error) && (
          <p className="ao-pipe-panel-note" data-tone={run.error || error ? 'error' : undefined}>
            {run.running ? (
              <>
                <span className="ao-pipe-pulse" /> {last?.text ?? 'Starting…'}
              </>
            ) : (
              (run.error ?? error ?? '').replace(/:\s*https:\/\/\S+$/, '')
            )}
          </p>
        )}
        {run.error && SSO.test(run.error) && <LinkOpener url={SSO.exec(run.error)![0]} />}
        {run.error && error && <p className="ao-task-panel-error">{error}</p>}

        {!run.workflowStarted ? (
          <section>
            <p className="ao-task-panel-label">The seven steps</p>
            <ol className="ao-wf-step-list">
              {STEP_LABELS.map((s, i) => (
                <li key={s.id}>
                  <span className="ao-wf-step-n">{i + 1}</span>
                  <span>
                    {s.label}
                    {s.manual && <small> — {s.manual}</small>}
                  </span>
                </li>
              ))}
            </ol>
            <p className="ao-task-panel-muted ao-wf-explain">
              Run workflow carries the task through these steps, in the task&apos;s own conversation. Each step&apos;s agent and model are the board&apos;s Step settings.
            </p>
          </section>
        ) : (
          <WorkflowSide run={run} act={act} />
        )}
      </div>

      <footer className="ao-task-panel-foot">
        <span className="ao-task-panel-muted">{run.workflowStarted ? (cur ? `Step ${cur.index + 1} of 7` : 'Finished') : ''}</span>
        <div className="ao-task-panel-actions">
          {run.running && (
            <button type="button" className="ao-btn-secondary" onClick={() => void act(() => call('runsStop', run.id))}>
              Stop
            </button>
          )}
          <button type="button" className="ao-btn-secondary" onClick={() => openTask(run.id, router)}>
            <BoardIcon size={14} /> Open task
          </button>
          {canStart && (
            <button type="button" className="ao-btn-primary" onClick={() => void act(() => call(run.workflowStarted ? 'runsRerun' : 'runsStartWorkflow', run.id))}>
              <PlayIcon size={14} /> {run.workflowStarted ? 'Run again' : 'Run workflow'}
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

/** Steps 1–5 as the panel's sections: the plan (copy to Jira), its review, the fix and the tests. */
function WorkflowSide({ run, act }: { run: Run; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = run.ticket;

  const copyPlan = async () => {
    if (!run.plan) return;
    await navigator.clipboard.writeText(`FJ AI Worker plan${t.key ? ` for ${t.key}` : ''}\n\n${run.plan}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {run.steps.review === 'waiting' && !run.running && (
        <section className="ao-wf-review">
          <p className="ao-task-panel-label">Step 3 — review the plan</p>
          {asking ? (
            <div className="ao-pipe-check-panel">
              <textarea className="ao-task-input ao-task-textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change in the plan?" autoFocus />
              <div className="ao-pipe-panel-actions">
                <button
                  type="button"
                  className="ao-btn-primary ao-btn-compact"
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
                <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => setAsking(false)}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="ao-pipe-panel-actions">
              <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => act(() => call('runsReview', run.id, { kind: 'approve' }))}>
                Approve
              </button>
              <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => setAsking(true)}>
                Ask for changes
              </button>
              <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => act(() => call('runsReview', run.id, { kind: 'skip' }))}>
                Skip
              </button>
            </div>
          )}
        </section>
      )}

      {run.plan && (
        <section>
          <p className="ao-task-panel-label">
            Plan{run.revisions.length > 0 && <span className="ao-task-panel-id">rev {run.revisions.length + 1}</span>}
            <span className="ao-spacer" />
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={copyPlan}>
              {copied ? 'Copied' : 'Copy for Jira'}
            </button>
          </p>
          <div className="ao-task-panel-desc ao-md-box">
            <Markdown text={run.plan} />
          </div>
          <label className="ao-pipe-check ao-wf-plan-check">
            <input type="checkbox" checked={run.planInTicket} onChange={(e) => void act(() => call('runsPlanInTicket', run.id, e.target.checked))} />
            <span>
              Added to {t.key || 'the ticket'} in Jira
              <small>By hand for now.</small>
            </span>
          </label>
        </section>
      )}

      <RunWork run={run} act={act} />
    </>
  );
}
