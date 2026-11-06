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
 * keychain) or Copilot's own browser sign-in, kept in that home.
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
let clientTunnel = false;
let starting: Promise<CopilotClient> | null = null;

const viaTunnel = () => getSettings().proxy.hosts.some((h) => /githubcopilot\.com$|github\.com$/.test(h));

/** The one runtime, started on first use; restarted when the sign-in or its routing changes. */
export async function copilotClient(): Promise<CopilotClient> {
  if (client && clientTunnel !== viaTunnel() && !starting) await stopCopilot();
  if (client) return client;
  starting ??= (async () => {
    const token = getSecret('copilot.token');
    const tunnel = viaTunnel();
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
    clientTunnel = tunnel;
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
    const c = await copilotClient();
    const s = await c.getAuthStatus();
    const account = { loggedIn: s.isAuthenticated, login: s.login ?? null, how: s.authType ?? null, message: s.statusMessage ?? null, tokenSet };
    if (!account.loggedIn) return account;
    // Signed in is not the same as allowed Copilot (a classic token signs in
    // but is refused): the model list is the first thing a task asks for.
    try {
      await c.listModels();
      return account;
    } catch (e) {
      return { ...account, loggedIn: false, message: `Signed in, but Copilot refused it: ${refusal(e)}` };
    }
  } catch (e) {
    return { loggedIn: false, login: null, how: null, message: e instanceof Error ? e.message : String(e), tokenSet };
  }
}

/** The reason in a refused request (its HTTP body), not the whole dump. */
function refusal(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const body = msg.match(/"body":"((?:[^"\\]|\\.)*)"/);
  const why = (body?.[1] ?? msg).replace(/\\n/g, ' ').trim();
  return /Personal Access Tokens are not supported/.test(why) ? 'a classic token (ghp_…) can’t use Copilot — sign in to Copilot, or use a fine-grained token.' : why.slice(0, 200);
}

/** A session for account calls only (the accounts API hangs off a session). */
async function accountSession(): Promise<CopilotSession> {
  return (await copilotClient()).createSession({ workingDirectory: copilotHome(), onPermissionRequest: () => ({ kind: 'reject' }) });
}

export type CopilotLoginEvent = { kind: 'done'; account: CopilotAccount } | { kind: 'error'; message: string };

let login: { flowId: string; session: CopilotSession } | null = null;

/**
 * Copilot's own browser sign-in (GitHub's OAuth for Copilot, a loopback
 * redirect the runtime listens for): resolves with the link to open; the
 * rest is waited for here and told through `onEvent`.
 */
export async function startCopilotLogin(onEvent: (ev: CopilotLoginEvent) => void): Promise<string> {
  await cancelCopilotLogin();
  // A pasted token wins over a signed-in account: dropped, the runtime started without it.
  if (getSecret('copilot.token')) {
    setSecret('copilot.token', null);
    await stopCopilot();
  }
  const session = await accountSession();
  const begun = await session.rpc.accounts.login.begin({ kind: 'githubDotCom' });
  if (begun.step.kind !== 'open-url') {
    await session.disconnect().catch(() => {});
    throw new Error(begun.step.kind === 'error' ? begun.step.message : `Unexpected sign-in step: ${begun.step.kind}`);
  }
  const flow = { flowId: begun.flowId, session };
  login = flow;
  void (async () => {
    try {
      for (;;) {
        const step = await session.rpc.accounts.login.advance({ flowId: flow.flowId });
        if (login !== flow) return;
        if (step.kind === 'error') throw new Error(step.message);
        if (step.kind === 'completed') {
          if (step.result.status !== 'completed') throw new Error(`Sign-in not finished (${step.result.status})`);
          break;
        }
      }
      login = null;
      await session.disconnect().catch(() => {});
      await stopCopilot();
      onEvent({ kind: 'done', account: await copilotAccount() });
    } catch (e) {
      if (login !== flow) return;
      login = null;
      await session.disconnect().catch(() => {});
      onEvent({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  })();
  return (begun.step as { url: string }).url;
}

export async function cancelCopilotLogin(): Promise<void> {
  const flow = login;
  login = null;
  if (!flow) return;
  await flow.session.rpc.accounts.login.cancel({ flowId: flow.flowId }).catch(() => {});
  await flow.session.disconnect().catch(() => {});
}

/** Out of Copilot: the pasted token dropped, or the signed-in account logged out. */
export async function copilotSignOut(): Promise<CopilotAccount> {
  if (getSecret('copilot.token')) return setCopilotToken(null);
  const session = await accountSession();
  try {
    await session.rpc.accounts.set({ command: { kind: 'logout' } });
  } finally {
    await session.disconnect().catch(() => {});
  }
  await stopCopilot();
  return copilotAccount();
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
    // A long fix takes as long as it takes (Stop aborts it); the SDK needs a
    // limit, and 0 means none at all — so a day.
    const reply = await session.sendAndWait({ prompt: opts.prompt }, 24 * 60 * 60 * 1000);
    if (opts.signal.aborted) throw new Error('Stopped');
    return reply?.data.content ?? '';
  } finally {
    opts.signal.removeEventListener('abort', onAbort);
    for (const id of subs) opts.events.onSubagentEnd(id, opts.signal.aborted ? 'stopped' : 'completed');
    off();
    await session.disconnect().catch(() => {});
  }
}
