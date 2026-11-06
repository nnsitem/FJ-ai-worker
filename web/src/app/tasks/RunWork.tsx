'use client';

import { useState } from 'react';
import { BranchIcon, ChevronRight, EditIcon, FolderIcon, TrashIcon } from '@/components/icons';
import { call, type Run } from '@/lib/bridge';
import { Markdown } from '@/lib/markdown';

type Act = (fn: () => Promise<unknown>) => Promise<void>;

/**
 * Steps 4–5 of a task, in the Workflow page's side panel (AI Office's
 * CardPanel sections): the fix on its branch (with the ticket moved by hand)
 * and the test rounds. What changed is the task's Changes panel.
 */
export function RunWork({ run, act }: { run: Run; act: Act }) {
  const t = run.ticket;
  if (run.steps.fix === 'pending') return null;
  return (
    <>
      <section>
        <p className="ao-task-panel-label">
          Step 4 — fix
          {run.branch && (
            <span className="ao-team-tag ao-branch-tag" data-kind="project" title={run.branch}>
              <BranchIcon size={11} /> {run.branch}
            </span>
          )}
        </p>
        <div className="ao-pipe-check-panel">
          {run.branch && (
            <label className="ao-pipe-check">
              <input type="checkbox" checked={run.movedInProgress} onChange={(e) => void act(() => call('runsMovedInProgress', run.id, e.target.checked))} />
              <span>
                Moved {t.key || 'the ticket'} to In progress in Jira
                <small>By hand until Jira is connected for writing.</small>
              </span>
            </label>
          )}
          {run.fixSummary ? (
            <div className="ao-task-panel-desc ao-md-box">
              <Markdown text={run.fixSummary} />
            </div>
          ) : (
            run.steps.fix === 'running' && <p className="ao-task-panel-muted">Claude is changing the code…</p>
          )}
          <div className="ao-pipe-panel-actions">
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'vscode'))}>
              Open in VS Code
            </button>
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'folder'))}>
              <FolderIcon size={13} /> Open folder
            </button>
            {!run.running && run.steps.fix === 'failed' && (
              <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsRetryFix', run.id))}>
                Fix again
              </button>
            )}
          </div>
        </div>
      </section>

      {(run.steps.test !== 'pending' || run.tests.length > 0) && <Tests run={run} act={act} />}

      {(run.steps.selfReview !== 'pending' || run.selfReviews.length > 0) && <SelfReviewSection run={run} act={act} />}
      {run.steps.pr !== 'pending' && <PullRequestSection run={run} act={act} />}
    </>
  );
}

const PR_STATE: Record<string, string> = { open: 'Open', closed: 'Closed', merged: 'Merged' };
const REVIEW_STATE: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'asked for changes', COMMENTED: 'commented', DISMISSED: 'dismissed' };

/**
 * Steps 6–7: push and open the pull request (on the person's go, unless the
 * workflow is set to go on its own), then its review — what reviewers said,
 * handed to Claude to deal with, pushed to the same PR. Merging is a
 * person's, on GitHub: there's no merge here.
 */
function PullRequestSection({ run, act }: { run: Run; act: Act }) {
  const t = run.ticket;
  const pr = run.pr;
  const open = run.feedback.filter((f) => !f.addressed);
  const busy = run.running;
  return (
    <section>
      <p className="ao-task-panel-label">
        Step 6–7 — pull request{pr && <> · <span className="ao-task-panel-id">#{pr.number}</span></>}
      </p>
      <div className="ao-pipe-check-panel">
        {run.steps.pr === 'waiting' && !busy && (
          <>
            <p className="ao-pipe-panel-note" data-tone="ready">
              {pr
                ? `Push the new commits on ${run.branch} to PR #${pr.number}?`
                : `Push ${run.branch} to origin and open a pull request into ${run.baseBranch}? It goes to the company's GitHub.`}
            </p>
            <div className="ao-pipe-panel-actions">
              <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsApprovePush', run.id))}>
                {pr ? 'Push to the PR' : 'Push & open PR'}
              </button>
            </div>
          </>
        )}
        {run.steps.pr === 'running' && <p className="ao-task-panel-muted">Pushing{pr ? '' : ' and opening the pull request'}…</p>}
        {run.steps.pr === 'failed' && !busy && (
          <div className="ao-pipe-panel-actions">
            <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsApprovePush', run.id))}>Try again</button>
          </div>
        )}
        {pr && (
          <>
            <div className="ao-pr-line">
              <span className="ao-pipe-verdict" data-verdict={pr.state === 'merged' ? 'approved' : pr.state === 'closed' ? 'changes' : undefined}>
                {pr.draft && pr.state === 'open' ? 'Draft' : PR_STATE[pr.state]}
              </span>
              <button type="button" className="ao-link-btn" onClick={() => void call('openExternal', pr.url)}>{pr.url.replace(/^https:\/\/github\.com\//, '')}</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="ao-btn-secondary ao-btn-compact" disabled={busy} onClick={() => void act(() => call('runsCheckPr', run.id))}>Check now</button>
            </div>
            {pr.reviews.length > 0 && (
              <ul className="ao-pr-reviews">
                {pr.reviews.map((rv) => (
                  <li key={rv.author}>
                    <b>{rv.author}</b> {REVIEW_STATE[rv.state] ?? rv.state.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
            <label className="ao-pipe-check">
              <input type="checkbox" checked={run.movedToReview} onChange={(e) => void act(() => call('runsMovedToReview', run.id, e.target.checked))} />
              <span>
                Moved {t.key || 'the ticket'} to Review in Jira
                <small>By hand until Jira is connected for writing.</small>
              </span>
            </label>
            {run.feedback.length > 0 && (
              <ul className="ao-pr-feedback">
                {run.feedback.map((f) => (
                  <li key={f.id} data-addressed={f.addressed || undefined}>
                    <span className="ao-pr-feedback-head">
                      <b>{f.author}</b>
                      {f.path && <code>{f.path}{f.line ? `:${f.line}` : ''}</code>}
                      {f.addressed && <span className="ao-task-panel-muted">handed to Claude</span>}
                    </span>
                    <span className="ao-pr-feedback-body">{f.body}</span>
                  </li>
                ))}
              </ul>
            )}
            {run.steps.humanReview === 'waiting' && !busy && (
              <div className="ao-pipe-panel-actions">
                {open.length > 0 && (
                  <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsFixReview', run.id))}>
                    Fix {open.length} comment{open.length === 1 ? '' : 's'} with Claude
                  </button>
                )}
                <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsFinishReview', run.id))}>Review done</button>
              </div>
            )}
            {pr.state !== 'open' && !run.branchDeleted && !busy && (
              <div className="ao-pipe-panel-actions">
                <button
                  type="button"
                  className="ao-btn-secondary ao-btn-compact"
                  onClick={() => window.confirm(`Delete ${run.branch} on GitHub and on this computer?`) && void act(() => call('runsDeleteBranch', run.id))}
                >
                  <TrashIcon size={13} /> Delete branch
                </button>
              </div>
            )}
            {run.branchDeleted && <p className="ao-task-panel-muted">{run.branch} deleted, on GitHub and here.</p>}
            <p className="ao-task-panel-muted ao-small-note">
              Looked at every few minutes while it waits for review (last {new Date(pr.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). FJ AI Worker never merges — a person does, on GitHub.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** A command the tests run with — shown, and changed in place. */
function CommandLine({ label, value, empty, placeholder, locked, onSave }: { label: string; value: string; empty: string; placeholder: string; locked: boolean; onSave: (v: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (editing)
    return (
      <div className="ao-place-row">
        <input className="ao-task-input ao-mono-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus />
        <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void onSave(text).then(() => setEditing(false))}>
          Save
        </button>
        <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => (setText(value), setEditing(false))}>
          Cancel
        </button>
      </div>
    );
  return (
    <p className="ao-task-panel-muted ao-test-command">
      <span className="ao-cmd-label">{label}</span>
      {value ? <code>{value}</code> : <span>{empty}</span>}
      {!locked && (
        <button type="button" className="ao-icon-btn" onClick={() => setEditing(true)} aria-label={`Change: ${label}`} title={`Change: ${label}`}>
          <EditIcon size={13} />
        </button>
      )}
    </p>
  );
}

const KIND_TEXT = { new: 'Caused by the change', preExisting: 'Same as before the change', env: 'Environment' } as const;

function Tests({ run, act }: { run: Run; act: Act }) {
  const [open, setOpen] = useState<number | null>(() => {
    const last = run.tests.at(-1);
    return last && !last.passed ? run.tests.length - 1 : null;
  });
  const [baseOpen, setBaseOpen] = useState(false);
  const waiting = run.steps.test === 'waiting' && !run.running;
  const stopped = run.steps.test === 'failed' && !run.running && !!run.error;
  const last = run.tests.at(-1);
  const b = run.baseline;
  return (
    <section>
      <p className="ao-task-panel-label">
        Step 5 — tests
        <span className="ao-task-panel-id">
          round {Math.max(run.round, 1)} of {run.maxRounds}
        </span>
      </p>
      <div className="ao-pipe-check-panel">
        <CommandLine
          label="Build / lint"
          value={run.checkCommand}
          empty="none"
          placeholder="e.g. mvn -q compile  ·  npm run lint && npx tsc --noEmit"
          locked={run.running}
          onSave={(v) => act(() => call('runsCheckCommand', run.id, v))}
        />
        <CommandLine
          label="Tests"
          value={run.testCommand}
          empty="Claude finds and runs them"
          placeholder="e.g. mvn -q test  ·  npm test — empty: Claude finds and runs the tests"
          locked={run.running}
          onSave={(v) => act(() => call('runsTestCommand', run.id, v))}
        />

        {b && (
          <div className="ao-baseline">
            <button type="button" className="ao-pipe-run" onClick={() => setBaseOpen((v) => !v)} aria-expanded={baseOpen}>
              <span className="ao-pipe-run-caret" data-open={baseOpen}>
                <ChevronRight size={11} />
              </span>
              <span className="ao-pipe-run-stage">Before the change</span>
              {b.check && <span className="ao-pipe-verdict" data-verdict={b.check.ok ? 'approved' : 'changes'}>Build {b.check.ok ? 'passes' : 'fails'}</span>}
              {b.test && <span className="ao-pipe-verdict" data-verdict={b.test.ok ? 'approved' : 'changes'}>Tests {b.test.ok ? 'pass' : 'fail'}</span>}
              <span className="ao-pipe-run-meta">on {b.base}</span>
            </button>
            {baseOpen && (
              <div className="ao-pipe-run-body">
                <pre className="ao-tool-detail">{[b.check && `$ ${run.checkCommand}\n${b.check.output}`, b.test && `$ ${run.testCommand}\n${b.test.output}`].filter(Boolean).join('\n\n') || '(no output)'}</pre>
              </div>
            )}
          </div>
        )}

        {run.tests.length > 0 && (
          <ul className="ao-pipe-runs">
            {run.tests.map((r, i) => (
              <li key={i}>
                <button type="button" className="ao-pipe-run" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span className="ao-pipe-run-caret" data-open={open === i}>
                    <ChevronRight size={11} />
                  </span>
                  <span className="ao-pipe-run-stage">Round {r.round}</span>
                  <span className="ao-pipe-verdict" data-verdict={r.passed ? 'approved' : r.kind === 'env' ? undefined : 'changes'}>
                    {r.passed ? (r.kind === 'preExisting' ? 'Passed*' : 'Passed') : r.kind === 'env' ? 'Couldn’t run' : 'Failed'}
                  </span>
                  <span className="ao-pipe-run-meta">
                    {r.kind ? `${KIND_TEXT[r.kind]} · ` : ''}
                    {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                {open === i && (
                  <div className="ao-pipe-run-body">
                    {r.why && <p className="ao-task-panel-muted">{r.kind === 'preExisting' ? '* ' : ''}{r.why}</p>}
                    <pre className="ao-tool-detail">{r.output || '(no output)'}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {run.steps.test === 'running' && <p className="ao-task-panel-muted">{run.baseline || !(run.testCommand || run.checkCommand) ? 'Testing…' : 'Testing the base before the change…'}</p>}

        {(waiting || stopped) && (
          <>
            {waiting && (
              <p className="ao-pipe-panel-note" data-tone="ready">
                {last?.kind === 'env'
                  ? `The tests couldn’t run here — ${last.why ?? 'the environment'}. Sort it out and test again, or go on to the review anyway.`
                  : `The tests still fail after ${run.round} rounds. Another round, or go on anyway?`}
              </p>
            )}
            <div className="ao-pipe-panel-actions">
              {last?.kind !== 'env' && (
                <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsRetryFix', run.id))}>
                  Another round
                </button>
              )}
              <button type="button" className={last?.kind === 'env' ? 'ao-btn-primary ao-btn-compact' : 'ao-btn-secondary ao-btn-compact'} onClick={() => void act(() => call('runsRetryTests', run.id))}>
                Test again
              </button>
              {waiting && (
                <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsAcceptTests', run.id))}>
                  Go on anyway
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Step 5½: another Claude's review of the diff — its verdict, findings, what the plan didn't name, secrets. */
function SelfReviewSection({ run, act }: { run: Run; act: Act }) {
  const [open, setOpen] = useState<number | null>(run.selfReviews.length ? run.selfReviews.length - 1 : null);
  const waiting = run.steps.selfReview === 'waiting' && !run.running;
  const stopped = run.steps.selfReview === 'failed' && !run.running && !!run.error;
  return (
    <section>
      <p className="ao-task-panel-label">Step 5½ — AI review of the diff</p>
      <div className="ao-pipe-check-panel">
        {run.steps.selfReview === 'running' && <p className="ao-task-panel-muted">A fresh Claude is reading the change…</p>}
        {run.steps.selfReview === 'skipped' && run.selfReviews.length === 0 && <p className="ao-task-panel-muted">Off in the workflow — skipped.</p>}
        {run.selfReviews.length > 0 && (
          <ul className="ao-pipe-runs">
            {run.selfReviews.map((rv, i) => (
              <li key={i}>
                <button type="button" className="ao-pipe-run" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span className="ao-pipe-run-caret" data-open={open === i}>
                    <ChevronRight size={11} />
                  </span>
                  <span className="ao-pipe-run-stage">Round {rv.round}</span>
                  <span className="ao-pipe-verdict" data-verdict={rv.verdict === 'approve' ? 'approved' : 'changes'}>
                    {rv.verdict === 'approve' ? 'Approved' : 'Changes'}
                  </span>
                  <span className="ao-pipe-run-meta">
                    {rv.secrets.length > 0 && `${rv.secrets.length} secret${rv.secrets.length === 1 ? '' : 's'} · `}
                    {rv.outOfPlan.length > 0 && `${rv.outOfPlan.length} outside the plan · `}
                    {new Date(rv.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                {open === i && (
                  <div className="ao-pipe-run-body">
                    {rv.secrets.length > 0 && (
                      <p className="ao-pipe-panel-note" data-tone="bad">
                        Looks like secrets in added lines: {rv.secrets.join('; ')}
                      </p>
                    )}
                    {rv.outOfPlan.length > 0 && (
                      <p className="ao-task-panel-muted">
                        Changed but not in the plan: {rv.outOfPlan.map((f) => <code key={f}>{f} </code>)}
                      </p>
                    )}
                    <div className="ao-task-panel-desc ao-md-box">
                      <Markdown text={rv.report} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {(waiting || stopped) && (
          <>
            {waiting && (
              <p className="ao-pipe-panel-note" data-tone="ready">
                The review still asks for changes. Another round of fixing, or on to the pull request anyway?
              </p>
            )}
            <div className="ao-pipe-panel-actions">
              {waiting && (
                <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsFixSelfReview', run.id))}>
                  Another round
                </button>
              )}
              <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsRetrySelfReview', run.id))}>
                Review again
              </button>
              <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsAcceptSelfReview', run.id))}>
                Go on anyway
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
