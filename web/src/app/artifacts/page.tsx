'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Picker } from '@/components/Picker';
import { ArtifactIcon, BoardIcon, CloseIcon, CodeIcon, EyeIcon, GridIcon, LinkIcon, SearchIcon, TableIcon, TrashIcon } from '@/components/icons';
import { bridge, call, type Artifact, type ArtifactKind } from '@/lib/bridge';
import { Markdown } from '@/lib/markdown';
import { OPEN_ARTIFACT_EVENT, OPEN_ARTIFACT_KEY, openTask, takeParked } from '@/lib/open';
import { usePanelResize } from '@/lib/use-panel-resize';

const KIND_LABEL: Record<ArtifactKind, string> = { doc: 'Document', data: 'Data', image: 'Image', pdf: 'PDF', office: 'Office' };
// Must match the slide-out on .ao-task-panel[data-closing] (team.css).
const PANEL_CLOSE_MS = 220;
const VIEW_PREF = 'aw.artifactsView';

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const whenLabel = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Artifacts, as AI Office's Artifacts page: the documents Claude wrote in
 * tasks, every version kept — a gallery or a table, filtered by kind and
 * searched; one opens in the side panel with its versions and preview.
 */
export default function ArtifactsPage() {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [kind, setKind] = useState<ArtifactKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'gallery' | 'table'>('gallery');
  const [openId, setOpenId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const { boardRef, width: panelWidth, startResize, resetWidth } = usePanelResize();

  const load = useCallback(() => {
    call('artifactsList').then(setItems).catch(() => setItems([]));
  }, []);

  const openPanel = useCallback(
    (id: string) => {
      window.clearTimeout(closeTimer.current);
      setClosing(false);
      setOpenId((cur) => {
        if (cur !== id) resetWidth();
        return id;
      });
    },
    [resetWidth],
  );
  const closePanel = () => {
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpenId(null);
      setClosing(false);
    }, PANEL_CLOSE_MS);
  };

  useEffect(() => {
    // The list, and again whenever a task's turn may have added some.
    load();
    try {
      const v = localStorage.getItem(VIEW_PREF);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered view, once
      if (v === 'table' || v === 'gallery') setView(v);
    } catch {
      // a per-machine nicety only
    }
    const wanted = takeParked(OPEN_ARTIFACT_KEY);
    if (wanted) openPanel(wanted);
    const onOpen = (e: Event) => {
      takeParked(OPEN_ARTIFACT_KEY);
      load();
      openPanel((e as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    const off = bridge().onRun((r) => {
      if (!('deleted' in r) && !r.running) load();
    });
    return () => {
      off();
      window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    };
  }, [load, openPanel]);

  const chooseView = (v: 'gallery' | 'table') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_PREF, v);
    } catch {
      // a per-machine nicety only
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((a) => (kind === 'all' || a.kind === kind) && (!q || `${a.name} ${a.relPath} ${a.taskTitle}`.toLowerCase().includes(q)));
  const open = items?.find((a) => a.id === openId) ?? null;
  const click = (id: string) => (id === openId && !closing ? closePanel() : openPanel(id));

  return (
    <main className="ao-board" ref={boardRef}>
      <section className="ao-panel ao-sessions">
        <header className="ao-panel-head">
          <h2 className="ao-panel-title">Artifacts</h2>
          <span className="ao-count">{shown.length}</span>
          <div className="ao-spacer" />
          <div className="ao-view-toggle" role="tablist" aria-label="View">
            <button type="button" className="ao-view-btn" data-active={view === 'gallery'} onClick={() => chooseView('gallery')}>
              <GridIcon size={13} />
              Gallery
            </button>
            <button type="button" className="ao-view-btn" data-active={view === 'table'} onClick={() => chooseView('table')}>
              <TableIcon size={13} />
              Table
            </button>
          </div>
        </header>

        {/* Filters on their own row: beside an open panel the header is too narrow to hold them. */}
        <div className="ao-art-filters">
          <span className="ao-spacer" />
          <Picker<ArtifactKind | 'all'>
            value={kind}
            onChange={setKind}
            options={[{ value: 'all', label: 'All kinds' }, ...(Object.keys(KIND_LABEL) as ArtifactKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
            ariaLabel="Kind"
          />
          <div className="ao-search-field ao-team-search ao-art-search">
            <SearchIcon size={14} />
            <input className="ao-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, path, task…" aria-label="Search artifacts" />
            {query && (
              <button type="button" className="ao-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <CloseIcon size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="ao-art-body">
          {items && items.length === 0 ? (
            <div className="ao-art-empty">
              <ArtifactIcon size={26} />
              <p>No artifacts yet</p>
              <span>Reports, notes, CSVs and images Claude writes in a task are kept here with every version.</span>
            </div>
          ) : items && shown.length === 0 ? (
            <p className="ao-art-none">Nothing matches.</p>
          ) : view === 'gallery' ? (
            <ul className="ao-art-grid" aria-busy={!items}>
              {!items &&
                Array.from({ length: 6 }, (_, i) => (
                  <li key={i}>
                    <div className="ao-art-card ao-art-card-skel" />
                  </li>
                ))}
              {shown.map((a) => (
                <li key={a.id}>
                  <div
                    className="ao-art-card"
                    data-active={a.id === openId && !closing}
                    role="button"
                    tabIndex={0}
                    onClick={() => click(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        click(a.id);
                      }
                    }}
                  >
                    <div className="ao-art-thumb" data-kind={a.kind}>
                      <span className="ao-art-thumb-ext">{a.ext.toUpperCase()}</span>
                    </div>
                    <div className="ao-art-card-main">
                      <div className="ao-art-card-title">
                        <span className="ao-art-name">{a.name}</span>
                        <span className="ao-art-kind" data-kind={a.kind}>
                          {KIND_LABEL[a.kind]}
                        </span>
                      </div>
                      <span className="ao-art-session">{a.taskTitle}</span>
                      <div className="ao-art-card-foot">
                        <span>
                          v{a.versions.length} · {whenLabel(a.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <table className="ao-art-table">
              <thead>
                <tr>
                  <th className="ao-art-col-name">Name</th>
                  <th className="ao-art-col-kind">Kind</th>
                  <th className="ao-art-col-session">Task</th>
                  <th className="ao-art-col-versions">Versions</th>
                  <th className="ao-art-col-size">Size</th>
                  <th className="ao-art-col-updated">Updated</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id} data-active={a.id === openId && !closing} onClick={() => click(a.id)}>
                    <td className="ao-art-col-name">
                      <span className="ao-art-name">{a.name}</span>
                      <span className="ao-art-path" title={a.relPath}>
                        {a.relPath}
                      </span>
                    </td>
                    <td className="ao-art-col-kind">
                      <span className="ao-art-kind" data-kind={a.kind}>
                        {KIND_LABEL[a.kind]}
                      </span>
                    </td>
                    <td className="ao-art-muted ao-art-col-session">{a.taskTitle}</td>
                    <td className="ao-art-muted ao-art-col-versions">v{a.versions.length}</td>
                    <td className="ao-art-muted ao-art-col-size">{formatBytes(a.versions.at(-1)?.size ?? 0)}</td>
                    <td className="ao-art-muted ao-art-col-updated">{whenLabel(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {open && (
        <>
          {!closing && <div className="ao-resizer" onMouseDown={startResize} />}
          <ArtifactPanel
            key={open.id}
            a={open}
            width={panelWidth}
            closing={closing}
            onClose={closePanel}
            onDeleted={() => {
              closePanel();
              load();
            }}
          />
        </>
      )}
    </main>
  );
}

/** One artifact, as AI Office's ArtifactPanel: its versions, the preview, and what to do with it. */
function ArtifactPanel({ a, width, closing, onClose, onDeleted }: { a: Artifact; width: number; closing: boolean; onClose: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const [hash, setHash] = useState(a.versions.at(-1)!.hash);
  const [content, setContent] = useState<{ hash: string; text: string | null; dataUrl: string | null } | null>(null);
  const [rendered, setRendered] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call('artifactsContent', a.id, hash)
      .then((c) => live && setContent({ hash, ...c }))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [a.id, hash]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const v = a.versions.find((x) => x.hash === hash) ?? a.versions.at(-1)!;
  const current = content?.hash === hash ? content : null;
  const isMarkdown = a.ext === 'md' || a.ext === 'markdown';
  const n = a.versions.length;

  return (
    <section className="ao-panel ao-detail ao-task-panel" data-closing={closing || undefined} style={{ flexBasis: `${width}px` }} aria-label={a.name}>
      <div className="ao-task-panel-inner" style={{ width: `${width}px` }}>
        <header className="ao-task-panel-head">
          <div className="ao-task-panel-heading">
            <div className="ao-task-panel-meta">
              <span className="ao-art-kind" data-kind={a.kind}>
                {KIND_LABEL[a.kind]}
              </span>
              <span className="ao-task-panel-id">{formatBytes(v.size)}</span>
            </div>
            <h2 className="ao-task-panel-title ao-art-panel-title">{a.name}</h2>
            <span className="ao-art-path" title={a.relPath}>
              {a.relPath}
            </span>
          </div>
          <button type="button" className="ao-icon-btn" onClick={onClose} aria-label="Close panel" title="Close">
            <CloseIcon size={15} />
          </button>
        </header>

        <div className="ao-art-toolbar">
          <Picker<string>
            value={hash}
            onChange={setHash}
            options={[...a.versions].reverse().map((x, i) => ({
              value: x.hash,
              label: `v${n - i}${i === 0 ? ' (latest)' : ''}`,
              hint: `${whenLabel(x.at)} · ${formatBytes(x.size)}`,
            }))}
            placement="down-start"
            ariaLabel="Version"
          />
          {isMarkdown && current?.text != null && (
            <div className="ao-view-toggle" role="tablist" aria-label="Preview">
              <button type="button" className="ao-view-btn" data-active={rendered} onClick={() => setRendered(true)}>
                <EyeIcon size={13} />
                Preview
              </button>
              <button type="button" className="ao-view-btn" data-active={!rendered} onClick={() => setRendered(false)}>
                <CodeIcon size={13} />
                Source
              </button>
            </div>
          )}
          <span className="ao-spacer" />
          <span className="ao-art-muted">
            {n} version{n === 1 ? '' : 's'}
          </span>
        </div>

        <div className="ao-task-panel-body ao-art-preview">
          {(error || note) && <p className={error ? 'ao-task-panel-error' : 'ao-task-panel-muted'}>{error ?? note}</p>}
          {!current ? (
            !error && (
              <div className="ao-art-preview-skel">
                <span className="ao-skel-line" style={{ width: '60%' }} />
                <span className="ao-skel-line" style={{ width: '92%' }} />
                <span className="ao-skel-line" style={{ width: '84%' }} />
              </div>
            )
          ) : current.dataUrl && a.kind === 'image' ? (
            // A stored copy, as a data: URL — not a remote image.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="ao-art-image" src={current.dataUrl} alt={a.name} />
          ) : current.text != null && (a.ext === 'csv' || a.ext === 'tsv') ? (
            <CsvTable text={current.text} sep={a.ext === 'tsv' ? '\t' : ','} />
          ) : current.text != null && isMarkdown && rendered ? (
            <div className="ao-art-markdown">
              <Markdown text={current.text} />
            </div>
          ) : current.text != null ? (
            <pre className="ao-art-source">{current.text}</pre>
          ) : (
            <div className="ao-art-empty">
              <p>No preview for {a.ext.toUpperCase()} here</p>
              <button type="button" className="ao-btn-secondary" onClick={() => void act(() => call('artifactsOpen', a.id, hash))}>
                <LinkIcon size={14} />
                Open v{n - [...a.versions].reverse().findIndex((x) => x.hash === hash)}
              </button>
            </div>
          )}
        </div>

        <footer className="ao-task-panel-foot">
          {confirmDelete ? (
            <div className="ao-task-panel-actions">
              <span className="ao-task-panel-muted">Delete {a.name} and its versions?</span>
              <button type="button" className="ao-btn-danger" onClick={() => void act(async () => (await call('artifactsDelete', a.id), onDeleted()))}>
                Delete
              </button>
              <button type="button" className="ao-btn-secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="ao-btn-secondary ao-task-editor-delete" onClick={() => setConfirmDelete(true)} title="Delete from Artifacts" aria-label="Delete from Artifacts">
                <TrashIcon size={14} />
              </button>
              <div className="ao-task-panel-actions">
                <button
                  type="button"
                  className="ao-btn-secondary"
                  onClick={() =>
                    void act(async () => {
                      const p = await call('artifactsSaveAs', a.id, hash);
                      if (p) setNote(`Saved to ${p}`);
                    })
                  }
                >
                  Save as…
                </button>
                <button type="button" className="ao-btn-secondary" onClick={() => void act(() => call('artifactsOpen', a.id, hash))}>
                  <LinkIcon size={14} />
                  Open
                </button>
                <button type="button" className="ao-btn-primary" onClick={() => openTask(a.taskId, router)}>
                  <BoardIcon size={14} />
                  Open task
                </button>
              </div>
            </>
          )}
        </footer>
      </div>
    </section>
  );
}

/** A CSV/TSV as a table (its first 500 rows); quotes understood, as most CSVs need. */
function CsvTable({ text, sep }: { text: string; sep: string }) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < 500; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [head, ...body] = rows;
  return (
    <div className="ao-csv">
      <table>
        {head && (
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
