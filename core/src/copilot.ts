import { CopilotClient, type CopilotSession, type CustomAgentConfig, type PermissionHandler } from '@github/copilot-sdk';
import fs from 'node:fs';
import { dataPath } from './config.js';
import { baseToolEnv } from './login-env.js';
import { getSecret, setSecret } from './secrets.js';
import { getSettings } from './settings.js';
import { socksBridge } from './socks-bridge.js';

/**
 * GitHub Copilot as a task's second engine (Claude is the first), through
 * the Copilot SDK — the Copilot CLI's own runtime, driven over JSON-RPC.
 *
 * Its own sign-in, apart from any Copilot on this machine: a home of its own
 * under the app's data (COPILOT_HOME), and either a token pasted in (a
 * fine-grained token with the Copilot Requests permission, sealed in the
 * keychain) or a `copilot login` run in that home from the app's terminal.
 * Its traffic can go through the VPN like GitHub's (Settings › VPN hosts,
 * through the local HTTP→SOCKS bridge), for an organisation that only lets
 * its own network in.
 */

export const copilotHome = (): string => {
  const d = dataPath('copilot');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

let client: CopilotClient | null = null;
let starting: Promise<CopilotClient> | null = null;

/** The one runtime, started on first use; restarted when the sign-in changes. */
export function copilotClient(): Promise<CopilotClient> {
  if (client) return Promise.resolve(client);
  starting ??= (async () => {
    const token = getSecret('copilot.token');
    const tunnel = getSettings().proxy.hosts.some((h) => /githubcopilot\.com$|github\.com$/.test(h));
    const bridge = tunnel ? await socksBridge() : null;
    const ca = getSettings().caFile;
    const c = new CopilotClient({
      baseDirectory: copilotHome(),
      ...(token ? { gitHubToken: token, useLoggedInUser: false } : { useLoggedInUser: true }),
      logLevel: 'error',
      env: {
        ...baseToolEnv(),
        COPILOT_HOME: copilotHome(),
        ...(bridge ? { HTTPS_PROXY: bridge, HTTP_PROXY: bridge, https_proxy: bridge, http_proxy: bridge } : {}),
        ...(ca && fs.existsSync(ca) ? { NODE_EXTRA_CA_CERTS: ca } : {}),
      },
    });
    await c.start();
    client = c;
    return c;
  })().finally(() => (starting = null));
  return starting;
}

export async function stopCopilot(): Promise<void> {
  const c = client;
  client = null;
  await c?.stop().catch(() => []);
}

export type CopilotAccount = { loggedIn: boolean; login: string | null; how: string | null; message: string | null; tokenSet: boolean };

export async function copilotAccount(): Promise<CopilotAccount> {
  const tokenSet = !!getSecret('copilot.token');
  try {
    const s = await (await copilotClient()).getAuthStatus();
    return { loggedIn: s.isAuthenticated, login: s.login ?? null, how: s.authType ?? null, message: s.statusMessage ?? null, tokenSet };
  } catch (e) {
    return { loggedIn: false, login: null, how: null, message: e instanceof Error ? e.message : String(e), tokenSet };
  }
}

/** A token for Copilot (or none, to sign out of it): kept, and the runtime restarted with it. */
export async function setCopilotToken(token: string | null): Promise<CopilotAccount> {
  setSecret('copilot.token', token?.trim() || null);
  await stopCopilot();
  return copilotAccount();
}

export async function copilotModels(): Promise<{ id: string; name: string }[]> {
  const models = await (await copilotClient()).listModels();
  return models.map((m) => ({ id: m.id, name: m.name }));
}

/** What a Copilot turn may do — the same rules as a Claude turn's. */
export type CopilotRules = {
  /** Read-only: no writes, no shell. */
  readOnly: boolean;
  allowWrite: (path: string) => boolean;
  /** A shell command it may run (null: may) or why not. */
  shellRefusal: (command: string) => string | null;
};

export type CopilotEvents = {
  onSession: (id: string) => void;
  onText: (text: string) => void;
  onTool: (name: string, args: Record<string, unknown>, parentCallId: string | null) => void;
  onSubagentStart: (callId: string, name: string, description: string) => void;
  onSubagentEnd: (callId: string, status: 'completed' | 'failed' | 'stopped') => void;
  onRefused: (what: string) => void;
};

/** One prompt to Copilot in a folder; resolves with its final reply. */
export async function copilotTurn(opts: {
  cwd: string;
  prompt: string;
  resume: string | null;
  model: string | null;
  system: string;
  agents: CustomAgentConfig[];
  agent: string | null;
  rules: CopilotRules;
  events: CopilotEvents;
  signal: AbortSignal;
}): Promise<string> {
  const c = await copilotClient();
  const auth = await c.getAuthStatus();
  if (!auth.isAuthenticated) throw new Error('Sign in to Copilot first (Connections › Copilot)');

  const permission: PermissionHandler = (req) => {
    if (req.kind === 'write') {
      const p = req.resolvedPath ?? req.fileName;
      if (opts.rules.readOnly || !opts.rules.allowWrite(p)) {
        opts.events.onRefused(`write ${p}`);
        return { kind: 'reject', feedback: opts.rules.readOnly ? 'This step only reads — no changes.' : 'Only files inside the task’s folder may be changed.' };
      }
      return { kind: 'approve-once' };
    }
    if (req.kind === 'shell') {
      const why = opts.rules.readOnly ? 'This step only reads — no commands.' : opts.rules.shellRefusal(req.fullCommandText);
      if (why) {
        opts.events.onRefused(req.fullCommandText.slice(0, 120));
        return { kind: 'reject', feedback: why };
      }
      return { kind: 'approve-once' };
    }
    if (req.kind === 'read' || req.kind === 'url' || req.kind === 'memory') return { kind: 'approve-once' };
    // MCP servers, extensions, hooks and the rest: not in a task.
    return { kind: 'reject', feedback: 'Not available in FJ AI Worker tasks.' };
  };

  const config = {
    workingDirectory: opts.cwd,
    ...(opts.model ? { model: opts.model } : {}),
    systemMessage: { mode: 'append' as const, content: opts.system },
    customAgents: opts.agents,
    ...(opts.agent ? { agent: opts.agent } : {}),
    onPermissionRequest: permission,
    clientName: 'FJ AI Worker',
  };
  let session: CopilotSession;
  try {
    session = opts.resume ? await c.resumeSession(opts.resume, config) : await c.createSession(config);
  } catch (e) {
    if (!opts.resume) throw e;
    session = await c.createSession(config);
  }
  opts.events.onSession(session.sessionId);
  const subs = new Set<string>();
  const off = session.on((ev) => {
    const d = (ev as { data?: Record<string, unknown> }).data ?? {};
    switch (ev.type) {
      case 'assistant.message':
        if (!d.parentToolCallId && typeof d.content === 'string' && d.content.trim()) opts.events.onText(d.content);
        break;
      case 'tool.execution_start':
        opts.events.onTool(String(d.toolName), (d.arguments as Record<string, unknown>) ?? {}, (d.parentToolCallId as string) ?? null);
        break;
      case 'subagent.started':
        subs.add(String(d.toolCallId));
        opts.events.onSubagentStart(String(d.toolCallId), String(d.agentName ?? d.agentDisplayName ?? 'subagent'), String(d.agentDescription ?? ''));
        break;
      case 'subagent.completed':
        subs.delete(String(d.toolCallId));
        opts.events.onSubagentEnd(String(d.toolCallId), d.cancelled ? 'stopped' : 'completed');
        break;
      case 'subagent.failed':
        subs.delete(String(d.toolCallId));
        opts.events.onSubagentEnd(String(d.toolCallId), 'failed');
        break;
    }
  });
  const onAbort = () => void session.abort().catch(() => {});
  opts.signal.addEventListener('abort', onAbort);
  try {
    // No timeout of its own: a long fix takes as long as it takes; Stop aborts it.
    const reply = await session.sendAndWait({ prompt: opts.prompt }, 0 as unknown as number);
    if (opts.signal.aborted) throw new Error('Stopped');
    return reply?.data.content ?? '';
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    for (const id of subs) opts.events.onSubagentEnd(id, opts.signal.aborted ? 'stopped' : 'completed');
    off();
    await session.disconnect().catch(() => {});
  }
}
