'use client';

import { useCallback, useEffect, useState } from 'react';
import { EditIcon, EyeIcon, FolderIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { call, type ProjectContext } from '@/lib/bridge';
import { Markdown } from '@/lib/markdown';

const label = (p: string) => (p.startsWith('folder:') ? (p.slice(7).split(/[\\/]/).filter(Boolean).pop() ?? p) : (p.split('/').pop() ?? p));
const group = (p: string) => (p.startsWith('folder:') ? p.slice(7) : p.split('/').slice(0, -1).join('/'));
const updated = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Agent Capabilities › Project context, as AI Office's (agents/ProjectContextView):
 * a note per project — a GitHub repo, or a folder of its own — that every
 * task about it is given: its stack, conventions not to "fix", known
 * pitfalls, what a review checks. The notes listed beside the editor.
 */
export function ProjectContextView() {
  const [notes, setNotes] = useState<ProjectContext[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [template, setTemplate] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [adding, setAdding] = useState('');
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call('projectContextList');
    setNotes(r.notes);
    setSuggestions(r.suggestions);
    setTemplate(r.template);
    return r;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the notes, read once
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const pick = (project: string, existing?: ProjectContext) => {
    if (text !== orig && !window.confirm('Discard the changes to this note?')) return;
    setOpen(project);
    setText(existing?.text ?? template.replace('<project>', label(project)));
    setOrig(existing?.text ?? '');
    setPreview(false);
    setNote(null);
    setError(null);
  };

  const save = async () => {
    if (!open) return;
    setError(null);
    try {
      const saved = await call('projectContextSave', open, text);
      setOrig(saved.text);
      setNote('Saved — tasks about this project get it from their next message.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!open) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setConfirmDelete(false);
    await call('projectContextDelete', open);
    setOpen(null);
    setText('');
    setOrig('');
    await load();
  };

  const addFolder = async () => {
    const f = await call('pickFolder', 'The project’s folder');
    if (f) pick(`folder:${f}`);
  };

  const current = notes?.find((n) => n.project === open);
  const exists = !!current;
  const dirty = text !== orig;

  return (
    <>
      <div className="ao-settings-header">
        <h2>Project context</h2>
        <p>A note per project that every task about it is given — what Claude should know before it touches the code.</p>
      </div>

      <div className="ao-library-banner">
        <FolderIcon size={16} />
        <span>
          A task&apos;s project is its repo — or, for a folder, the GitHub repo its <code>origin</code> points at, else the folder itself. The note goes into each of Claude&apos;s turns, and its path is{' '}
          <code>AI_PROJECT_CONTEXT</code> (the library&apos;s reviewer reads <code>AI_REVIEW_CONTEXT</code>).
        </span>
      </div>

      <div className="ao-status-card ao-pctx">
        <aside className="ao-pctx-list">
          <div className="ao-pctx-path-row">
            <input
              className="ao-task-input ao-mono-input"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && adding.trim()) {
                  pick(adding.trim());
                  setAdding('');
                }
              }}
              placeholder="owner/repo — Enter"
              aria-label="A repo to write a note for"
            />
          </div>
          <button type="button" className="ao-btn-secondary ao-btn-compact ao-pctx-add" onClick={() => void addFolder()}>
            <PlusIcon size={13} />
            A folder…
          </button>
          <p className="ao-pctx-list-label">Notes ({notes?.length ?? 0})</p>
          {notes?.length === 0 && <p className="ao-pctx-list-empty">No notes yet.</p>}
          {notes?.map((n) => {
            const unsaved = open === n.project && dirty;
            return (
              <button key={n.project} type="button" className="ao-pctx-item" data-active={open === n.project || undefined} onClick={() => pick(n.project, n)} title={n.project}>
                <span className="ao-pctx-item-name">
                  {label(n.project)}
                  {unsaved && <span className="ao-pctx-dot" aria-label="Unsaved changes" />}
                </span>
                <span className="ao-pctx-item-group">{group(n.project) || `Updated ${updated(n.updatedAt)}`}</span>
              </button>
            );
          })}
          {suggestions.length > 0 && (
            <>
              <p className="ao-pctx-list-label">Without a note</p>
              {suggestions.map((p) => (
                <button key={p} type="button" className="ao-pctx-item" data-active={open === p || undefined} onClick={() => pick(p)} title={p}>
                  <span className="ao-pctx-item-name">+ {label(p)}</span>
                  <span className="ao-pctx-item-group">{group(p)}</span>
                </button>
              ))}
            </>
          )}
        </aside>

        <div className="ao-pctx-editor">
          {!open ? (
            <div className="ao-pctx-new">
              <h3>Pick a project</h3>
              <p className="ao-pctx-new-sub">Name a repo at the left, pick a folder, or choose one of the projects your tasks work in to write its note.</p>
            </div>
          ) : (
            <>
              <header className="ao-pctx-head">
                <div className="ao-pctx-head-text">
                  <h3>{label(open)}</h3>
                  <code>{open}</code>
                </div>
                <div className="ao-view-toggle" role="group" aria-label="View">
                  <button type="button" className="ao-view-btn" data-active={!preview} onClick={() => setPreview(false)}>
                    <EditIcon size={13} />
                    Edit
                  </button>
                  <button type="button" className="ao-view-btn" data-active={preview} onClick={() => setPreview(true)}>
                    <EyeIcon size={13} />
                    Preview
                  </button>
                </div>
              </header>

              {preview ? (
                <div className="ao-pctx-preview">{text.trim() ? <Markdown text={text} /> : <p className="ao-pctx-list-empty">Nothing written yet.</p>}</div>
              ) : (
                <textarea
                  className="ao-task-input ao-task-textarea ao-pctx-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      void save();
                    }
                  }}
                  spellCheck={false}
                  aria-label={`Note for ${open}`}
                />
              )}

              <div className="ao-pctx-actions">
                <span className="ao-pctx-status">
                  {error ? (
                    <span className="ao-library-error">{error}</span>
                  ) : note && !dirty ? (
                    note
                  ) : dirty ? (
                    'Unsaved changes · ⌘S to save'
                  ) : current?.updatedAt ? (
                    `Last saved ${updated(current.updatedAt)}`
                  ) : null}
                </span>
                <span className="ao-spacer" />
                {dirty && exists && (
                  <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => setText(orig)}>
                    Discard
                  </button>
                )}
                {exists && (
                  <button type="button" className={`${confirmDelete ? 'ao-btn-danger' : 'ao-btn-secondary'} ao-btn-compact`} onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}>
                    <TrashIcon size={13} />
                    {confirmDelete ? 'Delete?' : 'Delete'}
                  </button>
                )}
                <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => void save()} disabled={!dirty && exists}>
                  {exists ? 'Save' : 'Create note'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
