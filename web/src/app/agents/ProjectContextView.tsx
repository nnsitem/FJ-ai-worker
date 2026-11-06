'use client';

import { useCallback, useEffect, useState } from 'react';
import { call, type ProjectContext } from '@/lib/bridge';

const label = (p: string) => (p.startsWith('folder:') ? p.slice(7).split(/[\\/]/).filter(Boolean).pop() ?? p : p);
const updated = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Agent Capabilities › Project context, as in AI Office: a note per project
 * (a GitHub repo, or a folder of its own) that every task about it is given —
 * its stack, conventions not to "fix", known pitfalls, what a review checks.
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
    const body = existing?.text ?? template.replace('<project>', label(project));
    setOpen(project);
    setText(body);
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
    if (!open || !window.confirm(`Delete the note for ${label(open)}?`)) return;
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

  const exists = !!notes?.some((n) => n.project === open);
  const dirty = text !== orig;

  return (
    <>
      <header className="aw-caps-head">
        <div>
          <h2>Project context</h2>
          <p>A note per project that every task about it is given — what Claude should know before it touches the code</p>
        </div>
      </header>
      <div className="aw-caps-banner">
        <span>
          A task&apos;s project is its repo — or, for a folder, the GitHub repo its <code>origin</code> points at, else the folder itself. The note goes into each of Claude&apos;s turns, and its path is{' '}
          <code>AI_PROJECT_CONTEXT</code> (the library&apos;s reviewer reads <code>AI_REVIEW_CONTEXT</code>).
        </span>
      </div>
      <div className="aw-skills-split aw-pc-split">
        <div className="aw-skills-list aw-pc-list">
          <div className="aw-pc-add">
            <input
              className="aw-input aw-compact aw-mono"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adding.trim() && (pick(adding.trim()), setAdding(''))}
              placeholder="owner/repo — Enter"
            />
            <button type="button" className="aw-btn aw-compact" onClick={() => void addFolder()}>Folder…</button>
          </div>
          {notes?.length === 0 && suggestions.length === 0 && <p className="aw-muted aw-small aw-pad">No notes yet — name a repo above, or pick a folder.</p>}
          {notes?.map((n) => (
            <button key={n.project} type="button" className="aw-skills-item" aria-current={open === n.project || undefined} onClick={() => pick(n.project, n)}>
              <span className="aw-skills-item-title aw-mono">{label(n.project)}</span>
              <span className="aw-skills-item-slug">{n.project.startsWith('folder:') ? n.project.slice(7) : `Updated ${updated(n.updatedAt)}`}</span>
            </button>
          ))}
          {suggestions.length > 0 && (
            <>
              <div className="aw-nav-label">Without a note</div>
              {suggestions.map((p) => (
                <button key={p} type="button" className="aw-skills-item aw-pc-suggest" aria-current={open === p || undefined} onClick={() => pick(p)}>
                  <span className="aw-skills-item-title aw-mono">+ {label(p)}</span>
                  {p.startsWith('folder:') && <span className="aw-skills-item-slug">{p.slice(7)}</span>}
                </button>
              ))}
            </>
          )}
        </div>
        {open ? (
          <section className="aw-skill-detail">
            <header className="aw-skill-detail-head">
              <div>
                <h3 className="aw-mono">{label(open)}</h3>
                <code>{open}</code>
              </div>
              <div className="aw-row">
                <div className="aw-segmented" role="tablist">
                  <button type="button" role="tab" aria-selected={!preview} onClick={() => setPreview(false)}>Edit</button>
                  <button type="button" role="tab" aria-selected={preview} onClick={() => setPreview(true)}>Preview</button>
                </div>
                {exists && <button type="button" className="aw-btn aw-compact" data-danger onClick={() => void remove()}>Delete</button>}
              </div>
            </header>
            {preview ? (
              <div className="aw-prose aw-pc-preview">{text}</div>
            ) : (
              <textarea className="aw-textarea aw-pc-editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            )}
            <div className="aw-row">
              <button type="button" className="aw-btn" data-primary disabled={!dirty && exists} onClick={() => void save()}>{exists ? 'Save' : 'Create note'}</button>
              {dirty && exists && <button type="button" className="aw-btn" onClick={() => setText(orig)}>Discard changes</button>}
              {note && <span className="aw-ok aw-small">{note}</span>}
              {error && <span className="aw-error">{error}</span>}
            </div>
          </section>
        ) : (
          <section className="aw-skill-detail aw-empty">Pick a project, or name one, to write its note.</section>
        )}
      </div>
    </>
  );
}
