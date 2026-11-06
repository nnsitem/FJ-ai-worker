import net from 'node:net';
import fs from 'node:fs';
import { getSettings, type Settings } from './settings.js';

/**
 * GitHub sits behind the company VPN: reachable only through the SOCKS
 * tunnel the VPN script opens, and re-signed on the way by the VPN's own CA
 * (it inspects TLS). Everything else (Claude, Jira Cloud) goes direct.
 *
 * The window and every call the main process makes go through Electron's
 * session, which takes the PAC script below; the desktop app hands its
 * session-bound fetch in here. Tools the app runs (git, gh, claude) get the
 * same routing through their environment (toolEnv).
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let sessionFetch: Fetch = (url, init) => fetch(url, init);

export function setSessionFetch(f: Fetch): void {
  sessionFetch = f;
}

/** A fetch that takes the tunnel for the tunnel's hosts. */
export function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  return sessionFetch(url, init);
}

/** Does a host go through the tunnel? */
export function viaTunnel(host: string, hosts = getSettings().proxy.hosts): boolean {
  const h = host.toLowerCase();
  return hosts.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p));
}

/** The PAC script for Electron's session: the tunnel's hosts by SOCKS, the rest direct. */
export function pacScript(s: Settings = getSettings()): string {
  const proxy = `SOCKS5 ${s.proxy.host}:${s.proxy.port}`;
  const tests = s.proxy.hosts.map((p) => `shExpMatch(host, ${JSON.stringify(p)})`).join(' || ') || 'false';
  return `function FindProxyForURL(url, host) { host = host.toLowerCase(); return (${tests}) ? ${JSON.stringify(proxy)} : "DIRECT"; }`;
}

/** Is anything listening on the tunnel's port? */
export function tunnelListening(s: Settings = getSettings(), timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: s.proxy.host, port: s.proxy.port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export type VpnStatus = {
  /** The tunnel's port answers. */
  tunnel: boolean;
  /** GitHub answered through it. */
  github: boolean;
  /** Why not, when it didn't. */
  error?: string;
  checkedAt: string;
};

export async function vpnStatus(): Promise<VpnStatus> {
  const checkedAt = new Date().toISOString();
  const tunnel = await tunnelListening();
  if (!tunnel) return { tunnel, github: false, error: 'The VPN tunnel is not open', checkedAt };
  try {
    const res = await httpFetch('https://api.github.com/zen', { signal: AbortSignal.timeout(10000) });
    return { tunnel, github: res.ok, error: res.ok ? undefined : `GitHub answered ${res.status}`, checkedAt };
  } catch (e) {
    return { tunnel, github: false, error: e instanceof Error ? e.message : String(e), checkedAt };
  }
}

/**
 * Environment for a tool the app runs, routed like the app:
 * - git: the tunnel for github.com only, set per run (GIT_CONFIG_*), so
 *   nobody's global git config is needed or changed;
 * - gh: talks to GitHub only, so all of it by the tunnel;
 * - Node-based tools (claude): the VPN's CA trusted on top of the usual ones.
 */
export function toolEnv(kind: 'git' | 'gh' | 'claude', s: Settings = getSettings()): Record<string, string> {
  const socks = `socks5h://${s.proxy.host}:${s.proxy.port}`;
  const env: Record<string, string> = {};
  if (s.caFile && fs.existsSync(s.caFile)) env.NODE_EXTRA_CA_CERTS = s.caFile;
  if (kind === 'gh') env.HTTPS_PROXY = socks;
  if (kind === 'git' || kind === 'claude') {
    // Claude's own git (pushing a branch) needs it as much as the app's.
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.proxy';
    env.GIT_CONFIG_VALUE_0 = socks;
  }
  return env;
}
