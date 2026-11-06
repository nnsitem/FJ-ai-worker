'use client';

import { useEffect, useRef, useState } from 'react';
import { call, type Run } from '@/lib/bridge';
import { STATE_TONE, STEP_LABELS } from './steps';
import { LinkOpener } from '@/components/LinkOpener';
import { RunWork } from './RunWork';

const STATE_TEXT = { pending: '', running: 'Working', waiting: 'Your turn', done: 'Done', skipped: 'Skipped', failed: 'Failed' } as const;

/** One run: its steps, the plan with the review, and what Claude did. */
export function RunPanel({ run, onDeleted }: { run: Run; onDeleted: () => void }) {
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(true);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [run.events.length]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copyPlan = async () => {
    if (!run.plan) return;
    await navigator.clipboard.writeText(`FJ AI Worker plan for ${run.ticket.key}\n\n${run.plan}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const t = run.ticket;
  const reviewing = run.steps.review === 'waiting' && !run.running;

  return (
    <article className="aw-detail">
      <div className="aw-row">
        <span className="aw-mono aw-muted">{t.key}</span>
        <span className="aw-mono aw-muted">· {run.repo}{run.baseBranch && `@${run.baseBranch}`}</span>
        <span style={{ flex: 1 }} />
        {t.url && <button type="button" className="aw-link-btn" onClick={() => void call('openExternal', t.url!)}>Open in Jira</button>}
      </div>
      <h2>{t.title || t.key}</h2>

      <ol className="aw-steps">
        {STEP_LABELS.map((s, i) => {
          const state = run.steps[s.id];
          return (
            <li key={s.id} className="aw-step" data-state={state}>
              <span className="aw-step-n">{i + 1}</span>
              <span className="aw-step-label">
                {s.label}
                {s.manual && <small> — {s.manual}</small>}
              </span>
              {state !== 'pending' && <span className="aw-pill" data-tone={STATE_TONE[state]}>{STATE_TEXT[state]}</span>}
            </li>
          );
        })}
      </ol>

      <div className="aw-row">
        {run.running ? (
          <button type="button" className="aw-btn" onClick={() => act(() => call('runsStop', run.id))}>Stop</button>
        ) : (
          (!run.plan || (run.error && run.steps.fix === 'pending')) && <button type="button" className="aw-btn" onClick={() => act(() => call('runsRerun', run.id))}>Run again</button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="aw-btn"
          data-danger
          onClick={() => {
            if (window.confirm(`Delete the run for ${t.key}? Its checkout goes too.`)) void act(async () => (await call('runsDelete', run.id), onDeleted()));
          }}
        >
          Delete
        </button>
      </div>
      {run.error && <p className="aw-error">{run.error.replace(/:\s*https:\/\/\S+$/, '')}</p>}
      {/* A link in the error (GitHub's SSO authorisation): opened where the company sign-in is. */}
      {run.error && /https:\/\/github\.com\/\S+\/sso\S*/.test(run.error) && (
        <LinkOpener url={/https:\/\/github\.com\/\S+\/sso\S*/.exec(run.error)![0]} />
      )}
      {error && <p className="aw-error">{error}</p>}

      {run.plan && (
        <section className="aw-card aw-plan">
          <div className="aw-card-head">
            <h2>Plan{run.revisions.length > 0 && <span className="aw-muted"> · revision {run.revisions.length + 1}</span>}</h2>
            <button type="button" className="aw-btn" onClick={copyPlan}>{copied ? 'Copied' : 'Copy for Jira'}</button>
          </div>
          <div className="aw-prose">{run.plan}</div>
          <label className="aw-check">
            <input type="checkbox" checked={run.planInTicket} onChange={(e) => void act(() => call('runsPlanInTicket', run.id, e.target.checked))} />
            <span>Added to {t.key} in Jira <span className="aw-muted">— step 2, by hand until Jira is connected</span></span>
          </label>
        </section>
      )}

      {reviewing && (
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
              <button type="button" className="aw-btn" onClick={() => act(() => call('runsReview', run.id, { kind: 'skip' }))}>Skip review</button>
            </div>
          )}
        </section>
      )}

      <RunWork run={run} act={act} />

      <section>
        <button type="button" className="aw-link-btn" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide' : 'Show'} what Claude did ({run.events.length})
        </button>
        {showLog && (
          <div className="aw-log">
            {run.events.map((e, i) => (
              <div key={i} className="aw-log-line" data-kind={e.kind}>
                {e.kind === 'you' ? <strong>You: </strong> : null}
                {e.text}
              </div>
            ))}
            {run.running && <div className="aw-log-line aw-muted">Working…</div>}
            <div ref={logEnd} />
          </div>
        )}
      </section>
    </article>
  );
}
