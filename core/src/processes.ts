import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Ending what a task started, all of it. Stopping a task stops its turn, but
 * the commands run along the way (a test command, or the AI's own shell —
 * mvn, a JVM, a dev server) are processes of their own that outlive their
 * shell when only the shell is killed.
 */

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(file, args, { maxBuffer: 16 * 1024 * 1024, timeout: 10000 }, (_e, out) => resolve(out ?? '')));

/** Processes the app's own terminals run (and everything under them): never swept. */
let protectedPids: () => number[] = () => [];
export function setProtectedPids(fn: () => number[]): void {
  protectedPids = fn;
}

/** TERM now, KILL a few seconds later for whatever is still there. */
export function terminate(pids: number[], group = false): void {
  const send = (sig: NodeJS.Signals) => {
    for (const p of pids) {
      try {
        process.kill(group ? -p : p, sig);
      } catch {
        /* already gone */
      }
    }
  };
  send('SIGTERM');
  setTimeout(() => send('SIGKILL'), 4000).unref();
}

/**
 * The app's own descendants working inside `dir` (their current folder
 * there), apart from its terminals and anything working in `except` — the
 * processes a task left running.
 * macOS and Linux; nothing elsewhere.
 */
export async function processesIn(dir: string, except: string[] = []): Promise<number[]> {
  if (process.platform === 'win32') return [];
  const children = new Map<number, number[]>();
  for (const line of (await run('ps', ['-axo', 'pid=,ppid='])).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const skip = new Set(protectedPids());
  const mine: number[] = [];
  const walk = (p: number) => {
    for (const c of children.get(p) ?? []) {
      if (skip.has(c)) continue;
      mine.push(c);
      walk(c);
    }
  };
  walk(process.pid);
  if (!mine.length) return [];
  const within = (p: string, d: string) => (p + path.sep).startsWith(path.resolve(d) + path.sep);
  const found: number[] = [];
  let pid = 0;
  for (const line of (await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', mine.join(',')])).split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && within(line.slice(1), dir) && !except.some((d) => within(line.slice(1), d))) found.push(pid);
  }
  return found;
}

/** Ends everything the app started that is still working in `dir` (but not in `except`, other live work). */
export async function sweep(dir: string, except: string[] = []): Promise<number> {
  const pids = await processesIn(dir, except);
  terminate(pids);
  return pids.length;
}

/**
 * A command through a login shell in its own process group, so Stop (the
 * signal) ends the command and everything it started, not just the shell.
 */
export function runInGroup(
  shell: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeoutMs: number; maxBytes: number },
): Promise<{ code: number | null; stdout: string; stderr: string; why: string | null }> {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(shell, args, { cwd: opts.cwd, env: opts.env, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const keep = (s: string, d: Buffer) => (s + d.toString()).slice(-opts.maxBytes);
    child.stdout.on('data', (d: Buffer) => (stdout = keep(stdout, d)));
    child.stderr.on('data', (d: Buffer) => (stderr = keep(stderr, d)));
    let why: string | null = null;
    const end = (reason: string) => {
      why ??= reason;
      if (child.pid) terminate([child.pid], !win);
    };
    const onAbort = () => end('stopped');
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => end(`timed out after ${Math.round(opts.timeoutMs / 60000)} min`), opts.timeoutMs);
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, why });
    };
    child.on('error', (e) => {
      why ??= e.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.on('exit', (code) => {
      // Whatever it left behind in its group (a server started with &) ends
      // with it; and a grandchild still holding the output open mustn't keep
      // the step waiting once the command itself has ended.
      if (child.pid && !win) terminate([child.pid], true);
      setTimeout(() => finish(code), 1000).unref();
    });
  });
}
