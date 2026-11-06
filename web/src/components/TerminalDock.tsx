'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, call, type TerminalInfo } from '@/lib/bridge';
import { DOCK_EVENT, type DockRequest } from '@/lib/terminal-dock';
import { TerminalView } from './TerminalView';
import { CloseIcon, PlusIcon, TerminalIcon, TrashIcon, VpnIcon } from './icons';

const HEIGHT_PREF = 'aw.terminalHeight';
const OPEN_PREF = 'aw.terminalOpen';
const MIN = 120;

const readPref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // a per-machine nicety only
  }
};

/**
 * The terminal panel under the page, as in VS Code: shown and hidden from the
 * top bar (or Ctrl+`), dragged taller or shorter by its top edge, maximised;
 * its terminals listed on the right. Hiding it leaves the terminals running.
 */
export function TerminalDock() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(280);
  const [terms, setTerms] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dock = useRef<HTMLElement>(null);
  const openNow = useRef(open);
  useEffect(() => {
    openNow.current = open;
  }, [open]);

  const refresh = useCallback(async () => {
    const list = await call('termList').catch(() => [] as TerminalInfo[]);
    setTerms(list);
    setActiveId((cur) => (cur && list.some((t) => t.id === cur) ? cur : (list.at(-1)?.id ?? null)));
    return list;
  }, []);

  const start = useCallback(
    async (kind: 'vpn' | 'shell') => {
      setError(null);
      try {
        const t = await call('termOpen', kind);
        await refresh();
        setActiveId(t.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh],
  );

  const show = useCallback(
    async (on: boolean) => {
      setOpen(on);
      writePref(OPEN_PREF, on ? '1' : '0');
      // Opened with nothing in it: a shell, as VS Code does.
      if (on && (await refresh()).length === 0) void start('shell');
    },
    [refresh, start],
  );

  useEffect(() => {
    const h = Number(readPref(HEIGHT_PREF));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered size and state, once
    if (h >= MIN) setHeight(h);
    if (readPref(OPEN_PREF) === '1') setOpen(true);
    void refresh();
    const off = bridge().onTerminal((ev) => {
      if (ev.kind === 'data') return;
      // Its last terminal closed from elsewhere (Disconnect VPN closes the
      // VPN's): the panel goes with it, as the ✕ on it would.
      void refresh().then((list) => {
        if (ev.kind === 'list' && list.length === 0 && openNow.current) {
          setOpen(false);
          writePref(OPEN_PREF, '0');
        }
      });
    });
    const onRequest = (e: Event) => {
      const req = (e as CustomEvent<DockRequest>).detail;
      if (req.action === 'toggle') {
        void show(!openNow.current);
      } else {
        setOpen(true);
        writePref(OPEN_PREF, '1');
        if (req.start) void start(req.start);
        else void show(true);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        onRequest(new CustomEvent(DOCK_EVENT, { detail: { action: 'toggle' } }));
      }
    };
    window.addEventListener(DOCK_EVENT, onRequest);
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener(DOCK_EVENT, onRequest);
      window.removeEventListener('keydown', onKey);
    };
  }, [refresh, show, start]);

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dock.current?.offsetHeight ?? height;
    const limit = () => Math.max(MIN, (dock.current?.parentElement?.offsetHeight ?? window.innerHeight) - 120);
    const move = (ev: PointerEvent) => setHeight(Math.min(limit(), Math.max(MIN, startH + startY - ev.clientY)));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writePref(HEIGHT_PREF, String(Math.min(limit(), Math.max(MIN, startH + startY - ev.clientY))));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const kill = async (id: string) => {
    await call('termClose', id);
    const list = await refresh();
    if (list.length === 0) void show(false);
  };

  if (!open) return null;

  return (
    <section ref={dock} className="ao-panel ao-dock" style={{ height }} aria-label="Terminal">
      <div className="ao-dock-grip" onPointerDown={drag} role="separator" aria-orientation="horizontal" aria-label="Resize the terminal" />
      <header className="ao-dock-head">
        <span className="ao-changes-tab" data-active="true">
          <TerminalIcon size={14} />
          <span>Terminal</span>
          {terms.some((t) => t.running) && <span className="ao-terminal-live-dot" aria-hidden="true" />}
        </span>
        {error && <span className="ao-dock-error">{error}</span>}
        <span className="ao-spacer" />
        <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void start('vpn')} title="Run the VPN script">
          <VpnIcon size={13} /> Connect VPN
        </button>
        <button type="button" className="ao-icon-btn" onClick={() => void start('shell')} title="New terminal" aria-label="New terminal">
          <PlusIcon size={15} />
        </button>
        <button type="button" className="ao-icon-btn" onClick={() => void show(false)} title="Hide the panel (Ctrl+`)" aria-label="Hide the panel">
          <CloseIcon size={15} />
        </button>
      </header>
      <div className="ao-dock-body">
        <div className="ao-dock-terms">
          {terms.map((t) => <TerminalView key={t.id} id={t.id} active={t.id === activeId} />)}
        </div>
        {terms.length > 1 && (
          <ul className="ao-dock-list" aria-label="Terminals">
            {terms.map((t) => (
              <li key={t.id} className="ao-dock-term-row">
                <button type="button" className="ao-dock-term" data-active={t.id === activeId} onClick={() => setActiveId(t.id)}>
                  {t.kind === 'vpn' ? <VpnIcon size={14} /> : <TerminalIcon size={14} />}
                  <span>{t.kind === 'vpn' ? 'VPN' : 'zsh'}</span>
                  {!t.running && <span className="ao-dock-ended">ended</span>}
                </button>
                {/* Its own bin — only with more than one (✕ above hides the panel). */}
                <button type="button" className="ao-icon-btn ao-dock-kill" onClick={() => void kill(t.id)} title="Kill this terminal" aria-label={`Kill ${t.kind === 'vpn' ? 'the VPN' : 'this'} terminal`}>
                  <TrashIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
