import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, type IPty } from 'node-pty';
import { loginPathNow } from '../../core/src/login-env.js';
import { setProtectedPids } from '../../core/src/processes.js';
import { getSettings } from '../../core/src/settings.js';

/**
 * Terminals inside the app (node-pty here, xterm.js in the window). Two
 * kinds, never an arbitrary command from the window: the person's own shell,
 * and the VPN script — so a tunnel that needs a sign-in (Cloudflare Access)
 * or fails shows its output where the person is, not in a separate app.
 *
 * Output is kept (the last part) so a terminal reopened after leaving the
 * page shows what it already printed. Closing the app ends the terminals;
 * the tunnel itself outlives them (the script's ssh -f runs on its own).
 */

export type TerminalKind = 'shell' | 'vpn';
export type TerminalInfo = { id: string; kind: TerminalKind; title: string; running: boolean; exitCode: number | null; startedAt: string };

type Term = TerminalInfo & { pty: IPty; buffer: string };

const KEEP = 256 * 1024;
const terms = new Map<string, Term>();
let seq = 0;

// A task's Stop sweeps what the app left running in its folder — never the
// person's own terminals (or what they started in them), even there.
setProtectedPids(() => [...terms.values()].filter((t) => t.running).map((t) => t.pty.pid));

let emit: (event: { kind: 'data'; id: string; data: string } | { kind: 'exit'; id: string; exitCode: number } | { kind: 'list' }) => void = () => {};
export function onTerminalEvent(fn: typeof emit): void {
  emit = fn;
}

const info = (t: Term): TerminalInfo => ({ id: t.id, kind: t.kind, title: t.title, running: t.running, exitCode: t.exitCode, startedAt: t.startedAt });

export function listTerminals(): TerminalInfo[] {
  return [...terms.values()].map(info);
}

export function openTerminal(kind: TerminalKind, cols = 100, rows = 30): TerminalInfo {
  const win = process.platform === 'win32';
  let file: string;
  let args: string[];
  let title: string;
  if (kind === 'vpn') {
    const script = getSettings().vpnScript;
    if (!script || !fs.existsSync(script)) throw new Error('Set the VPN script in Settings first');
    if (win) throw new Error('The VPN script is for macOS');
    // A running VPN terminal is reused: one script at a time.
    const running = [...terms.values()].find((t) => t.kind === 'vpn' && t.running);
    if (running) return info(running);
    // The script's ssh -f and its ProxyCommand (cloudflared) carry on after
    // the script ends — but cloudflared was started in this terminal's
    // session, and when the script exits the terminal hangs up on it
    // (SIGHUP) and the tunnel falls with it. Ignored here, the ignore is
    // inherited by everything the script starts (Go keeps an inherited
    // ignore too), so the tunnel outlives the script, the tab and the app.
    file = '/bin/bash';
    args = ['-c', `trap '' HUP; exec /bin/bash "$0"`, script];
    title = 'VPN';
  } else {
    file = win ? process.env.COMSPEC || 'powershell.exe' : process.env.SHELL || '/bin/zsh';
    args = win ? [] : ['-l'];
    title = 'Terminal';
  }
  const env = { ...process.env, PATH: loginPathNow(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: app.getName() } as Record<string, string>;
  const pty = spawn(file, args, { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env });
  const id = `t${++seq}`;
  const t: Term = { id, kind, title, running: true, exitCode: null, startedAt: new Date().toISOString(), pty, buffer: '' };
  terms.set(id, t);
  pty.onData((data) => {
    t.buffer = (t.buffer + data).slice(-KEEP);
    emit({ kind: 'data', id, data });
  });
  pty.onExit(({ exitCode }) => {
    t.running = false;
    t.exitCode = exitCode;
    emit({ kind: 'exit', id, exitCode });
    emit({ kind: 'list' });
  });
  emit({ kind: 'list' });
  return info(t);
}

/** What the terminal has printed so far (for a window that's just opened it). */
export function terminalBuffer(id: string): string {
  return terms.get(id)?.buffer ?? '';
}

export function writeTerminal(id: string, data: string): void {
  const t = terms.get(id);
  if (t?.running) t.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const t = terms.get(id);
  if (t?.running && cols > 0 && rows > 0) t.pty.resize(Math.floor(cols), Math.floor(rows));
}

/** Ends it (if still running) and forgets it. */
export function closeTerminal(id: string): void {
  const t = terms.get(id);
  if (!t) return;
  if (t.running) t.pty.kill();
  terms.delete(id);
  emit({ kind: 'list' });
}

/** The VPN script's terminals closed — with the tunnel, on Disconnect VPN. */
export function closeVpnTerminals(): void {
  for (const t of [...terms.values()]) if (t.kind === 'vpn') closeTerminal(t.id);
}

export function closeAllTerminals(): void {
  for (const t of terms.values()) if (t.running) t.pty.kill();
  terms.clear();
}
