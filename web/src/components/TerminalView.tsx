'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { bridge, call } from '@/lib/bridge';

/** The app's colours for the terminal: its card ground, the brand for the cursor and selection. */
function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    background: v('--background') || '#0c0b10',
    foreground: v('--foreground') || '#ecebf0',
    cursor: '#e1306c',
    cursorAccent: v('--background') || '#0c0b10',
    selectionBackground: dark ? 'rgba(225, 48, 108, 0.35)' : 'rgba(194, 24, 91, 0.25)',
    magenta: '#e1306c',
    brightMagenta: '#ff6b98',
    red: '#ff5f5f',
    green: dark ? '#3fb950' : '#0a8037',
    yellow: dark ? '#e0a92e' : '#8f5800',
    blue: dark ? '#6ea8ff' : '#1a5fe6',
    cyan: dark ? '#4fd1c5' : '#00786d',
  };
}

/** One terminal (terminal.ts in the desktop app): what it printed so far, then live. */
export function TerminalView({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: theme(),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;

    let live = true;
    const pending: string[] = [];
    let replayed = false;
    // Live output that lands while the earlier output is still being fetched waits its turn.
    const off = bridge().onTerminal((ev) => {
      if (ev.kind !== 'data' || ev.id !== id) return;
      if (replayed) t.write(ev.data);
      else pending.push(ev.data);
    });
    void call('termBuffer', id).then((buf) => {
      if (!live) return;
      t.write(buf);
      for (const d of pending) t.write(d);
      replayed = true;
    });
    const input = t.onData((d) => bridge().termWrite(id, d));
    const resize = t.onResize(({ cols, rows }) => bridge().termResize(id, cols, rows));
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0) f.fit();
    });
    ro.observe(el);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const retheme = () => (t.options.theme = theme());
    scheme.addEventListener('change', retheme);
    return () => {
      live = false;
      off();
      input.dispose();
      resize.dispose();
      ro.disconnect();
      scheme.removeEventListener('change', retheme);
      t.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (!active) return;
    fit.current?.fit();
    term.current?.focus();
  }, [active]);

  return <div ref={box} className="aw-term" hidden={!active} />;
}
