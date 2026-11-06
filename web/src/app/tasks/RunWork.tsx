'use client';

import { useState } from 'react';
import { BranchIcon, ChevronRight, EditIcon, FolderIcon } from '@/components/icons';
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

      {(run.steps.test === 'done' || run.steps.test === 'skipped') && (
        <p className="ao-pipe-panel-note">
          Next, step 6: FJ AI Worker commits, pushes {run.branch} and opens the pull request, and you move {t.key || 'the ticket'} to Review — coming in M5.
        </p>
      )}
    </>
  );
}

function Tests({ run, act }: { run: Run; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(run.testCommand);
  const [open, setOpen] = useState<number | null>(() => {
    const last = run.tests.at(-1);
    return last && !last.passed ? run.tests.length - 1 : null;
  });
  const waiting = run.steps.test === 'waiting' && !run.running;
  const stopped = run.steps.test === 'failed' && !run.running && !!run.error;
  return (
    <section>
      <p className="ao-task-panel-label">
        Step 5 — tests
        <span className="ao-task-panel-id">
          round {Math.max(run.round, 1)} of {run.maxRounds}
        </span>
      </p>
      <div className="ao-pipe-check-panel">
        {editing ? (
          <div className="ao-place-row">
            <input className="ao-task-input ao-mono-input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="empty: Claude finds and runs the tests" autoFocus />
            <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(async () => (await call('runsTestCommand', run.id, command), setEditing(false)))}>
              Save
            </button>
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => (setCommand(run.testCommand), setEditing(false))}>
              Cancel
            </button>
          </div>
        ) : (
          <p className="ao-task-panel-muted ao-test-command">
            {run.testCommand ? (
              <>
                Runs <code>{run.testCommand}</code>
              </>
            ) : (
              'Claude finds and runs the tests'
            )}
            {!run.running && (
              <button type="button" className="ao-icon-btn" onClick={() => setEditing(true)} aria-label="Change the test command" title="Change the test command">
                <EditIcon size={13} />
              </button>
            )}
          </p>
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
                  <span className="ao-pipe-verdict" data-verdict={r.passed ? 'approved' : 'changes'}>
                    {r.passed ? 'Passed' : 'Failed'}
                  </span>
                  <span className="ao-pipe-run-meta">
                    {r.by === 'command' ? 'test command' : 'Claude'} · {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                {open === i && (
                  <div className="ao-pipe-run-body">
                    <pre className="ao-tool-detail">{r.output || '(no output)'}</pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {run.steps.test === 'running' && <p className="ao-task-panel-muted">Testing…</p>}

        {(waiting || stopped) && (
          <>
            {waiting && (
              <p className="ao-pipe-panel-note" data-tone="ready">
                The tests still fail after {run.round} rounds. Another round, or go on to the pull request anyway?
              </p>
            )}
            <div className="ao-pipe-panel-actions">
              <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void act(() => call('runsRetryFix', run.id))}>
                Another round
              </button>
              <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsRetryTests', run.id))}>
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
