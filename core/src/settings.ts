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
  jira: {
    /** The Jira Cloud site, e.g. https://tdem.atlassian.net */
    site: string;
    /** The account the API token belongs to. */
    email: string;
  };
  /** Which repo a Jira project's tickets are fixed in. */
  projects: ProjectLink[];
  /** Per repo (owner/name): how its tests run (step 5), remembered from the last run. */
  repos: Record<string, RepoSettings>;
  /** How the seven steps run (Workflow page). */
  workflow: WorkflowSettings;
  /** The agent a new task starts with (Agents & skills); null: plain Claude Code. */
  defaultAgent: string | null;
};

/** A step Claude does: a library agent and a model, each null for the task's own. */
export type StepAgent = { agent: string | null; model: string | null };

export type WorkflowSettings = {
  /** Steps 1–2. */
  analyse: StepAgent;
  /** Step 3: a person approves the plan (off: it goes straight on). */
  review: { enabled: boolean };
  /** Step 4. */
  fix: StepAgent;
  /** Step 5 (off: no tests, straight to step 6); rounds before it waits for you. */
  test: StepAgent & { enabled: boolean; rounds: number };
  /** Step 6: wait for a person's go before pushing; open the PR as a draft. */
  pr: { confirm: boolean; draft: boolean };
};

export type RepoSettings = {
  /** A shell command run in the checkout; empty: Claude finds and runs the tests itself. */
  testCommand: string;
};

export type ProjectLink = {
  /** Jira project key, e.g. BF9. */
  jiraKey: string;
  /** GitHub owner/name. */
  repo: string;
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
  jira: { site: '', email: '' },
  projects: [],
  repos: {},
  workflow: {
    analyse: { agent: null, model: null },
    review: { enabled: true },
    fix: { agent: null, model: null },
    test: { agent: null, model: null, enabled: true, rounds: 3 },
    pr: { confirm: true, draft: true },
  },
  defaultAgent: null,
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
    jira: { ...DEFAULT_SETTINGS.jira, ...s.jira },
    projects: s.projects ?? [],
    repos: s.repos ?? {},
    workflow: mergeWorkflow(DEFAULT_SETTINGS.workflow, s.workflow),
    defaultAgent: s.defaultAgent ?? null,
  };
}

type WorkflowPatch = { [K in keyof WorkflowSettings]?: Partial<WorkflowSettings[K]> };

function mergeWorkflow(base: WorkflowSettings, patch?: WorkflowPatch): WorkflowSettings {
  return {
    analyse: { ...base.analyse, ...patch?.analyse },
    review: { ...base.review, ...patch?.review },
    fix: { ...base.fix, ...patch?.fix },
    test: { ...base.test, ...patch?.test },
    pr: { ...base.pr, ...patch?.pr },
  };
}

export type SettingsPatch = {
  proxy?: Partial<Settings['proxy']>;
  vpnScript?: string;
  caFile?: string;
  github?: Partial<Settings['github']>;
  claude?: Partial<Settings['claude']>;
  jira?: Partial<Settings['jira']>;
  projects?: ProjectLink[];
  repos?: Record<string, RepoSettings>;
  workflow?: WorkflowPatch;
  defaultAgent?: string | null;
};

export function saveSettings(patch: SettingsPatch): Settings {
  const cur = getSettings();
  const next: Settings = {
    proxy: { ...cur.proxy, ...patch.proxy },
    vpnScript: patch.vpnScript ?? cur.vpnScript,
    caFile: patch.caFile ?? cur.caFile,
    github: { ...cur.github, ...patch.github },
    claude: { ...cur.claude, ...patch.claude },
    jira: { ...cur.jira, ...patch.jira },
    projects: patch.projects ?? cur.projects,
    repos: { ...cur.repos, ...patch.repos },
    workflow: mergeWorkflow(cur.workflow, patch.workflow),
    defaultAgent: patch.defaultAgent !== undefined ? patch.defaultAgent || null : cur.defaultAgent,
  };
  next.workflow.test.rounds = Math.min(10, Math.max(1, Math.round(Number(next.workflow.test.rounds) || 3)));
  next.jira.site = normaliseSite(next.jira.site);
  next.jira.email = next.jira.email.trim();
  next.projects = next.projects
    .map((p) => ({ jiraKey: p.jiraKey.trim().toUpperCase(), repo: p.repo.trim() }))
    .filter((p) => p.jiraKey && p.repo);
  next.proxy.port = Number(next.proxy.port) || DEFAULT_SETTINGS.proxy.port;
  next.proxy.hosts = next.proxy.hosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  next.claude.expectedEmail = next.claude.expectedEmail.trim().toLowerCase();
  writeJson(FILE, next);
  return next;
}

/** `tdem.atlassian.net/`, `https://tdem.atlassian.net/jira` → `https://tdem.atlassian.net`. */
export function normaliseSite(site: string): string {
  const t = site.trim();
  if (!t) return '';
  try {
    return new URL(/^https?:\/\//.test(t) ? t : `https://${t}`).origin;
  } catch {
    return t;
  }
}

/** The repo a ticket's project is linked to, if any. */
export function repoForProject(jiraKey: string): string | null {
  return getSettings().projects.find((p) => p.jiraKey === jiraKey.toUpperCase())?.repo ?? null;
}
