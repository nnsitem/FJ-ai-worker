import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * The terminal's PATH — an app opened from the Finder gets only
 * /usr/bin:/bin, so no Homebrew (gh, node). Asked once of the login shell;
 * until it answers, and on Windows, the app's own PATH stands.
 *
 * Only PATH: nothing else from the shell is carried over, so an
 * ANTHROPIC_API_KEY or CLAUDE_* in someone's .zshrc never reaches the
 * company's Claude (claude-account.ts builds that environment from scratch).
 */
let cached: string | null = null;
let pending: Promise<string> | null = null;

const EXTRA = () => ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];

function finish(fromShell: string): string {
  if (process.platform === 'win32') return process.env.PATH ?? '';
  const parts = [...fromShell.split(':'), ...(process.env.PATH ?? '').split(':'), ...EXTRA()];
  return [...new Set(parts.filter(Boolean))].join(':');
}

export function loadLoginPath(): Promise<string> {
  if (cached) return Promise.resolve(cached);
  pending ??= new Promise((resolve) => {
    if (process.platform === 'win32') return resolve((cached = finish('')));
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s\\n" "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      const m = !err && /__PATH__(.*)/.exec(stdout ?? '');
      resolve((cached = finish(m ? m[1].trim() : '')));
    });
  });
  return pending;
}

export function loginPathNow(): string {
  return cached ?? finish('');
}

/**
 * The base environment for every tool the app runs: the system's own
 * variables (HOME, USER, TMPDIR, …) and the terminal's PATH, with anything
 * that would pick a Claude account or API backend taken out.
 */
export function baseToolEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (/^(ANTHROPIC_|CLAUDE_|CLAUDECODE|AWS_BEARER_TOKEN_BEDROCK|VERTEX_|CLOUD_ML_)/.test(k)) continue;
    // Whatever proxy the shell had is not the app's routing (network.ts).
    if (/^(https?|all|no)_proxy$/i.test(k)) continue;
    env[k] = v;
  }
  env.PATH = loginPathNow();
  return env;
}
