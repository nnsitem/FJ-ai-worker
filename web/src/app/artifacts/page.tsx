'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/Panel';
import { ArtifactsIcon } from '@/components/icons';
import { bridge, call, type Artifact, type ArtifactKind } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';

const FILTERS: { id: ArtifactKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'doc', label: 'Documents' },
  { id: 'data', label: 'Data' },
  { id: 'image', label: 'Images' },
  { id: 'pdf', label: 'PDF' },
  { id: 'office', label: 'Office' },
];

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Artifacts, as in AI Office: the documents Claude wrote in tasks, with every version kept. */
export default function ArtifactsPage() {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [filter, setFilter] = useState<ArtifactKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    call('artifactsList').then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    // The list, and again whenever a task's turn may have added some.
    load();
    return bridge().onRun((r) => {
      if (!('deleted' in r) && !r.running) load();
    });
  }, [load]);

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter((a) => (filter === 'all' || a.kind === filter) && (!q || `${a.name} ${a.relPath} ${a.taskTitle}`.toLowerCase().includes(q)));
  const open = items?.find((a) => a.id === openId) ?? null;

  return (
    <div className="aw-split">
      <Panel title="Artifacts" sub="Documents Claude wrote in your tasks — every version kept">
        <div className="aw-filter">
          <div className="aw-tabs aw-wrap" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" className="aw-tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <input className="aw-input aw-compact" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, path or task" />
        </div>
        <div className="aw-panel-body">
          {items && shown.length === 0 && (
            <p className="aw-muted aw-pad">{items.length === 0 ? 'Nothing yet. Reports, notes, CSVs and images Claude writes in a task show up here.' : 'Nothing matches.'}</p>
          )}
          <ul className="aw-rows">
            {shown.map((a) => (
              <li key={a.id}>
                <button type="button" className="aw-row-btn" aria-current={a.id === openId || undefined} onClick={() => setOpenId(a.id)}>
                  <span className="aw-art-ext" data-kind={a.kind}>{a.ext}</span>
                  <span className="aw-row-title">{a.name}</span>
                  <span className="aw-muted aw-small">{a.versions.length > 1 ? `${a.versions.length} versions` : ''}</span>
                  <span className="aw-row-meta">
                    {a.taskTitle} · {when(a.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
      <section className="aw-panel">
        {open ? (
          <ArtifactView key={open.id} a={open} onDeleted={() => (setOpenId(null), load())} />
        ) : (
          <div className="aw-empty">
            <ArtifactsIcon size={28} />
            Pick a document to read it.
          </div>
        )}
      </section>
    </div>
  );
}

function ArtifactView({ a, onDeleted }: { a: Artifact; onDeleted: () => void }) {
  const router = useRouter();
  const [hash, setHash] = useState(a.versions.at(-1)!.hash);
  const [content, setContent] = useState<{ text: string | null; dataUrl: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call('artifactsContent', a.id, hash)
      .then((c) => live && setContent(c))
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
  const v = a.versions.find((x) => x.hash === hash)!;

  return (
    <>
      <header className="aw-panel-head">
        <div className="aw-panel-head-text">
          <h1 className="aw-panel-title">{a.name}</h1>
          <p className="aw-panel-sub aw-mono">{a.relPath}</p>
        </div>
        {a.versions.length > 1 && (
          <select className="aw-input aw-select aw-compact" value={hash} onChange={(e) => (setContent(null), setHash(e.target.value))} aria-label="Version">
            {[...a.versions].reverse().map((x, i) => (
              <option key={x.hash} value={x.hash}>
                {i === 0 ? 'Latest' : `Version ${a.versions.length - i}`} · {when(x.at)}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="aw-btn aw-compact" onClick={() => void act(() => call('artifactsOpen', a.id, hash))}>Open</button>
        <button
          type="button"
          className="aw-btn aw-compact"
          onClick={() =>
            void act(async () => {
              const p = await call('artifactsSaveAs', a.id, hash);
              if (p) setNote(`Saved to ${p}`);
            })
          }
        >
          Save as…
        </button>
        <button
          type="button"
          className="aw-btn aw-compact"
          onClick={() => {
            try {
              sessionStorage.setItem(OPEN_TASK_KEY, a.taskId);
            } catch {
              // the Tasks page opens its first
            }
            router.push('/tasks');
          }}
        >
          Task
        </button>
        <button type="button" className="aw-btn aw-compact" data-danger onClick={() => window.confirm(`Delete ${a.name} and its versions?`) && void act(async () => (await call('artifactsDelete', a.id), onDeleted()))}>
          Delete
        </button>
      </header>
      <div className="aw-panel-body">
        <div className="aw-art-meta aw-muted aw-small">
          {a.taskTitle} · {size(v.size)} · {when(v.at)}
          {note && <span className="aw-ok"> · {note}</span>}
          {error && <span className="aw-error"> · {error}</span>}
        </div>
        {!content ? (
          <p className="aw-muted aw-pad">Loading…</p>
        ) : content.dataUrl && a.kind === 'image' ? (
          <div className="aw-art-image">
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored copy, as a data: URL */}
            <img src={content.dataUrl} alt={a.name} />
          </div>
        ) : content.text != null && (a.ext === 'csv' || a.ext === 'tsv') ? (
          <Table text={content.text} sep={a.ext === 'tsv' ? '\t' : ','} />
        ) : content.text != null ? (
          <div className="aw-prose aw-art-text">{content.text}</div>
        ) : (
          <p className="aw-muted aw-pad">No preview for {a.ext.toUpperCase()} here — Open shows it in its own app.</p>
        )}
      </div>
    </>
  );
}

/** A CSV/TSV as a table (its first 500 rows); quotes understood, as most CSVs need. */
function Table({ text, sep }: { text: string; sep: string }) {
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
    <div className="aw-art-table">
      <table>
        {head && (
          <thead>
            <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
