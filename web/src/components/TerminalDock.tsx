'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge, call, type TerminalInfo } from '@/lib/bridge';
import { DOCK_EVENT, type DockRequest } from '@/lib/terminal-dock';
import { TerminalView } from './TerminalView';
import { AddIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, TerminalIcon, TrashIcon, VpnIcon } from './icons';

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
  const [max, setMax] = useState(false);
  const [terms, setTerms] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dock = useRef<HTMLDivElement>(null);
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
      if (ev.kind !== 'data') void refresh();
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
    setMax(false);
    const move = (ev: PointerEvent) => setHeight(Math.min(limit(), Math.max(MIN, startH + startY - ev.clientY)));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writePref(HEIGHT_PREF, String(Math.min(limit(), Math.max(MIN, startH + startY - ev.clientY))));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const kill = async () => {
    if (!activeId) return;
    await call('termClose', activeId);
    const list = await refresh();
    if (list.length === 0) void show(false);
  };

  if (!open) return null;
  const active = terms.find((t) => t.id === activeId) ?? null;

  return (
    <div ref={dock} className="aw-dock" data-max={max || undefined} style={max ? undefined : { height }}>
      <div className="aw-dock-grip" onPointerDown={drag} role="separator" aria-orientation="horizontal" aria-label="Resize the terminal" />
      <div className="aw-dock-head">
        <span className="aw-dock-title">Terminal</span>
        {error && <span className="aw-error aw-dock-error">{error}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="aw-dock-btn aw-dock-vpn" onClick={() => void start('vpn')} title="Run the VPN script">
          <VpnIcon size={14} /> Connect VPN
        </button>
        <button type="button" className="aw-dock-btn" onClick={() => void start('shell')} title="New terminal" aria-label="New terminal">
          <AddIcon size={15} />
        </button>
        <button type="button" className="aw-dock-btn" onClick={kill} disabled={!active} title="Kill the terminal" aria-label="Kill the terminal">
          <TrashIcon size={15} />
        </button>
        <button type="button" className="aw-dock-btn" onClick={() => setMax((m) => !m)} title={max ? 'Restore panel size' : 'Maximise panel size'} aria-label={max ? 'Restore panel size' : 'Maximise panel size'}>
          {max ? <ChevronDownIcon size={15} /> : <ChevronUpIcon size={15} />}
        </button>
        <button type="button" className="aw-dock-btn" onClick={() => void show(false)} title="Hide the panel (Ctrl+`)" aria-label="Hide the panel">
          <CloseIcon size={15} />
        </button>
      </div>
      <div className="aw-dock-body">
        <div className="aw-dock-terms">
          {terms.map((t) => <TerminalView key={t.id} id={t.id} active={t.id === activeId} />)}
        </div>
        {terms.length > 1 && (
          <ul className="aw-dock-list" aria-label="Terminals">
            {terms.map((t) => (
              <li key={t.id}>
                <button type="button" aria-current={t.id === activeId || undefined} onClick={() => setActiveId(t.id)}>
                  {t.kind === 'vpn' ? <VpnIcon size={14} /> : <TerminalIcon size={14} />}
                  <span>{t.kind === 'vpn' ? 'VPN' : 'zsh'}</span>
                  {!t.running && <span className="aw-dock-ended">ended</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
