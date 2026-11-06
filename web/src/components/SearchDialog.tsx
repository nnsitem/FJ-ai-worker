'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { call, type Artifact, type Run } from '@/lib/bridge';
import { NAV_ITEMS, routeOf } from '@/lib/nav-items';
import { openArtifact, openTask } from '@/lib/open';
import { ArtifactIcon, BoardIcon, ChevronRight, CloseIcon, SearchIcon } from './icons';

type Kind = 'page' | 'task' | 'artifact';
interface Hit {
  key: string;
  kind: Kind;
  title: string;
  hint: string;
  go: () => void;
}

const GROUP: Record<Kind, string> = { page: 'Pages', task: 'Tasks', artifact: 'Artifacts' };
const ICON: Record<Kind, ComponentType<{ size?: number }>> = { page: ChevronRight, task: BoardIcon, artifact: ArtifactIcon };
const ORDER: Kind[] = ['page', 'task', 'artifact'];
const PER_GROUP = 6;

/** Every word of the query somewhere in the text, any order, any case. */
function matches(q: string[], ...fields: (string | null | undefined)[]): boolean {
  const text = fields.filter(Boolean).join(' ').toLowerCase();
  return q.every((w) => text.includes(w));
}

const where = (r: Run) => (r.source === 'repo' ? r.repo : r.source === 'folder' ? (r.folder ?? '') : '');

/**
 * AI Office's search (components/SearchDialog.tsx, ⌘K): the app's pages, its
 * tasks and artifacts — each result opens where it lives. Read when it opens,
 * so it's always current. A <dialog> in <body>, out of the top bar's drag
 * region (where Electron swallows clicks).
 */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const router = useRouter();
  const path = routeOf(usePathname());
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tasks, setTasks] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the portal's target exists only in the browser
    setMounted(true);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, mounted]);

  // What there is to find, read fresh on each open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    call('runsList').then((r) => alive && setTasks(r)).catch(() => {});
    call('artifactsList').then((a) => alive && setArtifacts(a)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out: Hit[] = [];
    const to = (href: string) => {
      onClose();
      if (path !== href) router.push(href);
    };
    for (const n of NAV_ITEMS) {
      if (!q.length || matches(q, n.label)) out.push({ key: `p:${n.href}`, kind: 'page', title: n.label, hint: 'Go to page', go: () => to(n.href) });
    }
    // With nothing typed: the latest tasks, to jump straight back into one.
    const t = (q.length ? tasks.filter((r) => matches(q, r.ticket.key, r.ticket.title, r.agent, where(r))) : tasks).slice(0, PER_GROUP);
    for (const r of t) {
      out.push({
        key: `t:${r.id}`,
        kind: 'task',
        title: `${r.ticket.key ? `${r.ticket.key} ` : ''}${r.ticket.title || 'New task'}`,
        hint: where(r).split(/[\\/]/).filter(Boolean).pop() ?? 'no folder',
        go: () => {
          onClose();
          openTask(r.id, router);
        },
      });
    }
    if (q.length) {
      for (const a of artifacts.filter((x) => matches(q, x.name, x.relPath, x.taskTitle)).slice(0, PER_GROUP)) {
        out.push({
          key: `a:${a.id}`,
          kind: 'artifact',
          title: a.name,
          hint: a.taskTitle,
          go: () => {
            onClose();
            openArtifact(a.id, router);
          },
        });
      }
    }
    return out;
  }, [query, tasks, artifacts, path, router, onClose]);

  const safeActive = Math.min(active, Math.max(0, hits.length - 1));
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      hits[safeActive]?.go();
    }
  };

  if (!mounted) return null;

  let index = -1;
  return createPortal(
    <dialog
      ref={ref}
      className="ao-search-dialog"
      onClose={onClose}
      // A click on the element itself is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="ao-search-dialog-body">
        <div className="ao-search-dialog-field">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            className="ao-search-dialog-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Search tasks, pages, artifacts…"
            aria-label="Search"
            aria-controls="ao-search-results"
          />
          <button type="button" className="ao-icon-btn" onClick={onClose} aria-label="Close search">
            <CloseIcon size={15} />
          </button>
        </div>

        {hits.length === 0 ? (
          <p className="ao-search-note">Nothing matches “{query.trim()}”.</p>
        ) : (
          <ul className="ao-search-results" id="ao-search-results" role="listbox" ref={listRef}>
            {ORDER.map((kind) => {
              const group = hits.filter((h) => h.kind === kind);
              if (!group.length) return null;
              const Icon = ICON[kind];
              return (
                <li key={kind} role="presentation">
                  <p className="ao-search-group">{kind === 'task' && !query.trim() ? 'Recent tasks' : GROUP[kind]}</p>
                  <ul role="presentation">
                    {group.map((h) => {
                      index++;
                      const i = index;
                      return (
                        <li
                          key={h.key}
                          role="option"
                          aria-selected={i === safeActive}
                          data-index={i}
                          className="ao-search-hit"
                          onMouseMove={() => i !== safeActive && setActive(i)}
                          onClick={h.go}
                        >
                          <Icon size={15} />
                          <span className="ao-search-hit-title">{h.title}</span>
                          <span className="ao-search-hit-hint">{h.hint}</span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}

        <p className="ao-search-foot">
          <kbd className="ao-kbd">↑↓</kbd> to move · <kbd className="ao-kbd">↵</kbd> to open · <kbd className="ao-kbd">esc</kbd> to close
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
