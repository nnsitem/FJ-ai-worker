'use client';

import { useEffect, useState } from 'react';
import { call, type ChangedFile, type Run } from '@/lib/bridge';

/**
 * Steps 4–5 of a run: the fix on its branch (with the ticket moved by hand),
 * the test rounds, and what changed.
 */
export function RunWork({ run, act }: { run: Run; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const t = run.ticket;
  const started = run.steps.fix !== 'pending';
  if (!started) return null;
  return (
    <>
      <section className="aw-card">
        <div className="aw-card-head">
          <h2>Step 4 — fix</h2>
          {run.branch && <span className="aw-pill aw-mono" data-tone="info">{run.branch}</span>}
        </div>
        {run.branch && (
          <label className="aw-check">
            <input type="checkbox" checked={run.movedInProgress} onChange={(e) => void act(() => call('runsMovedInProgress', run.id, e.target.checked))} />
            <span>Moved {t.key} to In progress in Jira <span className="aw-muted">— by hand until Jira is connected</span></span>
          </label>
        )}
        {run.fixSummary ? <div className="aw-prose aw-summary">{run.fixSummary}</div> : run.steps.fix === 'running' && <p className="aw-muted">Claude is changing the code…</p>}
        <div className="aw-row">
          <button type="button" className="aw-btn" onClick={() => void act(() => call('runsOpenFolder', run.id, 'vscode'))}>Open in VS Code</button>
          <button type="button" className="aw-btn" onClick={() => void act(() => call('runsOpenFolder', run.id, 'folder'))}>Open folder</button>
          {!run.running && run.steps.fix === 'failed' && (
            <button type="button" className="aw-btn" data-primary onClick={() => void act(() => call('runsRetryFix', run.id))}>Fix again</button>
          )}
        </div>
      </section>

      {(run.steps.test !== 'pending' || run.tests.length > 0) && <TestsCard run={run} act={act} />}
      {run.steps.fix !== 'running' && run.branch && <ChangesCard run={run} />}

      {(run.steps.test === 'done' || run.steps.test === 'skipped') && (
        <p className="aw-note">Next, step 6: FJ AI Worker commits, pushes {run.branch} and opens the pull request, and you move {t.key} to Review — coming in M5.</p>
      )}
    </>
  );
}

function TestsCard({ run, act }: { run: Run; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(run.testCommand);
  const waiting = run.steps.test === 'waiting' && !run.running;
  const stopped = run.steps.test === 'failed' && !run.running && !!run.error;
  return (
    <section className="aw-card" data-attention={waiting || undefined}>
      <div className="aw-card-head">
        <h2>Step 5 — tests</h2>
        <span className="aw-muted aw-small">round {Math.max(run.round, 1)} of {run.maxRounds}</span>
      </div>
      {editing ? (
        <div className="aw-row aw-nowrap">
          <input className="aw-input aw-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="empty: Claude finds and runs the tests" autoFocus />
          <button type="button" className="aw-btn" data-primary onClick={() => void act(async () => (await call('runsTestCommand', run.id, command), setEditing(false)))}>Save</button>
          <button type="button" className="aw-btn" onClick={() => (setCommand(run.testCommand), setEditing(false))}>Cancel</button>
        </div>
      ) : (
        <div className="aw-row">
          <span className="aw-muted aw-small">{run.testCommand ? <>Runs <code>{run.testCommand}</code></> : 'Claude finds and runs the tests'}</span>
          {!run.running && <button type="button" className="aw-link-btn" onClick={() => setEditing(true)}>Change</button>}
        </div>
      )}

      {run.tests.length > 0 && (
        <ul className="aw-tests">
          {run.tests.map((r, i) => (
            <li key={i}>
              <details open={i === run.tests.length - 1 && !r.passed}>
                <summary>
                  <span className="aw-pill" data-tone={r.passed ? 'ok' : 'bad'}>{r.passed ? 'Passed' : 'Failed'}</span>
                  <span>Round {r.round}</span>
                  <span className="aw-muted aw-small">{r.by === 'command' ? 'test command' : 'Claude'} · {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </summary>
                <pre className="aw-output">{r.output || '(no output)'}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      {run.steps.test === 'running' && <p className="aw-muted">Testing…</p>}

      {(waiting || stopped) && (
        <>
          {waiting && <p>The tests still fail after {run.round} rounds. Another round, or go on to the pull request anyway?</p>}
          <div className="aw-row">
            <button type="button" className="aw-btn" data-primary onClick={() => void act(() => call('runsRetryFix', run.id))}>Another round</button>
            <button type="button" className="aw-btn" onClick={() => void act(() => call('runsRetryTests', run.id))}>Test again</button>
            {waiting && <button type="button" className="aw-btn" onClick={() => void act(() => call('runsAcceptTests', run.id))}>Go on anyway</button>}
          </div>
        </>
      )}
    </section>
  );
}

function ChangesCard({ run }: { run: Run }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again whenever the run moves on (a new round changes files).
  useEffect(() => {
    let live = true;
    call('runsChanges', run.id)
      .then((f) => live && setFiles(f))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [run.id, run.round, run.steps.fix]);

  const show = async (file: string) => {
    if (open === file) return setOpen(null);
    setOpen(file);
    setDiff(null);
    try {
      setDiff(await call('runsFileDiff', run.id, file));
    } catch (e) {
      setDiff(`(${(e as Error).message})`);
    }
  };

  return (
    <section className="aw-card">
      <div className="aw-card-head">
        <h2>Changes</h2>
        {files && <span className="aw-muted aw-small">{files.length} file{files.length === 1 ? '' : 's'}</span>}
      </div>
      {error && <p className="aw-error">{error}</p>}
      {files && files.length === 0 && <p className="aw-muted">Nothing changed yet.</p>}
      {files && files.length > 0 && (
        <ul className="aw-files">
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" className="aw-file" aria-expanded={open === f.path} onClick={() => void show(f.path)}>
                <span className="aw-file-status" data-s={f.status[0]}>{f.status[0]}</span>
                <span className="aw-file-path aw-mono">{f.path}</span>
                {f.added != null && <span className="aw-add">+{f.added}</span>}
                {f.removed != null && f.removed > 0 && <span className="aw-del">−{f.removed}</span>}
              </button>
              {open === f.path && <Diff text={diff} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Diff({ text }: { text: string | null }) {
  if (text == null) return <p className="aw-muted aw-small">Loading…</p>;
  const lines = text.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
  return (
    <pre className="aw-diff">
      {lines.map((l, i) => (
        <div key={i} data-k={l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : undefined}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}
