import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { readJson, writeJson } from './config.js';

/**
 * The person's settings for this machine. Secrets (tokens) are not here —
 * they're sealed in secrets.ts.
 */
export type Settings = {
  proxy: {
    /** The SOCKS tunnel the VPN script opens (ssh -D). */
    host: string;
    port: number;
    /** Hosts that go through the tunnel; `*.` matches any subdomain. Everything else goes direct. */
    hosts: string[];
  };
  /** The script that opens the tunnel, offered when it's down. */
  vpnScript: string;
  /** The VPN's inspecting CA (PEM), added to what Node-based tools trust. */
  caFile: string;
  github: {
    /** An OAuth App's client id, for signing in with the device flow. */
    clientId: string;
  };
  claude: {
    /** The company account; runs are refused under any other. */
    expectedEmail: string;
  };
};

const fujitsu = path.join(os.homedir(), 'Workspace', 'Fujitsu');
const existing = (p: string) => (fs.existsSync(p) ? p : '');

export const DEFAULT_SETTINGS: Settings = {
  proxy: {
    host: '127.0.0.1',
    port: 1080,
    hosts: ['github.com', '*.github.com', '*.githubusercontent.com'],
  },
  vpnScript: existing(path.join(fujitsu, 'fujitsu-vpn-edge.command')),
  caFile: existing(path.join(fujitsu, 'toyota-tdem-root-ca.pem')),
  github: { clientId: '' },
  claude: { expectedEmail: '' },
};

const FILE = 'settings.json';

export function getSettings(): Settings {
  const s = readJson<Partial<Settings>>(FILE, {});
  return {
    proxy: { ...DEFAULT_SETTINGS.proxy, ...s.proxy },
    vpnScript: s.vpnScript ?? DEFAULT_SETTINGS.vpnScript,
    caFile: s.caFile ?? DEFAULT_SETTINGS.caFile,
    github: { ...DEFAULT_SETTINGS.github, ...s.github },
    claude: { ...DEFAULT_SETTINGS.claude, ...s.claude },
  };
}

export type SettingsPatch = {
  proxy?: Partial<Settings['proxy']>;
  vpnScript?: string;
  caFile?: string;
  github?: Partial<Settings['github']>;
  claude?: Partial<Settings['claude']>;
};

export function saveSettings(patch: SettingsPatch): Settings {
  const cur = getSettings();
  const next: Settings = {
    proxy: { ...cur.proxy, ...patch.proxy },
    vpnScript: patch.vpnScript ?? cur.vpnScript,
    caFile: patch.caFile ?? cur.caFile,
    github: { ...cur.github, ...patch.github },
    claude: { ...cur.claude, ...patch.claude },
  };
  next.proxy.port = Number(next.proxy.port) || DEFAULT_SETTINGS.proxy.port;
  next.proxy.hosts = next.proxy.hosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  next.claude.expectedEmail = next.claude.expectedEmail.trim().toLowerCase();
  writeJson(FILE, next);
  return next;
}
