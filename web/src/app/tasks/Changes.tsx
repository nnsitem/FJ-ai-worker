'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, FileIcon } from '@/components/icons';
import { call, type ChangedFile, type Run } from '@/lib/bridge';

/** git's one-letter status, as AI Office's changes list names it. */
const STATUS: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'renamed', U: 'conflicted', '?': 'untracked' };

/**
 * What the task changed against where it started, as AI Office's git
 * changes list ((shell)/page.tsx GitChangesList): each file opening as its
 * diff. Read again whenever the run moves on (a new round changes files).
 */
export function ChangesList({ run, onCount }: { run: Run; onCount?: (n: number) => void }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call('runsChanges', run.id)
      .then((f) => {
        if (!live) return;
        setFiles(f);
        setError(null);
        onCount?.(f.length);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
    // Re-read when the run's work moves on, not on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, run.round, run.steps.fix, run.running]);

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

  if (error) return <p className="ao-changes-note ao-task-panel-error">{error}</p>;
  if (!files) return <p className="ao-changes-note">Reading the changes…</p>;
  if (files.length === 0)
    return (
      <div className="ao-changes-empty">
        <FileIcon size={22} />
        <p>Nothing changed yet</p>
      </div>
    );

  const additions = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.removed ?? 0), 0);

  return (
    <>
      <div className="ao-git-files-head">
        <span className="ao-changes-totals">
          {files.length} file{files.length === 1 ? '' : 's'} <span className="ao-diff-add">+{additions}</span> <span className="ao-diff-del">−{deletions}</span>
        </span>
      </div>
      <ul className="ao-workspace-list">
        {files.map((f) => {
          const isOpen = open === f.path;
          const slash = f.path.lastIndexOf('/');
          const letter = f.status[0] ?? 'M';
          return (
            <li key={f.path} className="ao-git-row">
              <button type="button" className="ao-workspace-file" data-open={isOpen} onClick={() => void show(f.path)} title={f.path}>
                <span className="ao-workspace-caret" data-open={isOpen}>
                  <ChevronRight size={12} />
                </span>
                <span className="ao-git-status" data-status={STATUS[letter] ?? 'modified'}>
                  {letter === '?' ? 'U' : letter}
                </span>
                <span className="ao-workspace-name">
                  {f.path.slice(slash + 1)}
                  {slash > 0 && <span className="ao-git-dir"> {f.path.slice(0, slash)}</span>}
                </span>
                <span className="ao-git-counts">
                  {f.added == null ? (
                    <span className="ao-git-binary">binary</span>
                  ) : (
                    <>
                      {f.added > 0 && <span className="ao-diff-add">+{f.added}</span>}
                      {(f.removed ?? 0) > 0 && <span className="ao-diff-del">−{f.removed}</span>}
                    </>
                  )}
                </span>
              </button>
              {isOpen && <DiffView text={diff} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A unified diff, its lines tinted by kind; git's header lines dropped (the row names the file). */
function DiffView({ text }: { text: string | null }) {
  if (text == null) return <pre className="ao-workspace-preview">Loading…</pre>;
  const lines = text.split('\n');
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
  const body = firstHunk === -1 ? lines : lines.slice(firstHunk);
  if (body.join('').trim() === '') return <pre className="ao-workspace-preview">{text.trim() || 'No textual changes.'}</pre>;
  return (
    <pre className="ao-workspace-preview ao-diff">
      {body.map((line, i) => (
        <span key={i} className="ao-diff-line" data-kind={line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : undefined}>
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}
