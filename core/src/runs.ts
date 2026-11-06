import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './config.js';
import { assertClaudeAccount, claudeEnv, claudeExecutable } from './claude-account.js';
import { baseToolEnv } from './login-env.js';
import { toolEnv } from './network.js';
import { collectArtifacts } from './artifacts.js';
import { agentDefinition, readLibrary } from './library.js';
import { copilotTurn } from './copilot.js';
import { projectNote, taskProject } from './project-context.js';
import { createWorktree, git, gitLocal, localOrigin, removeWorktree, syncRepo, worktreeDir } from './repos.js';
import { githubState, githubToken } from './github.js';
import { deleteRemoteBranch, openPullRequest, readPullRequest, type Feedback, type PullRequest } from './pull-requests.js';
import { getSettings, saveSettings, type StepAgent } from './settings.js';

/**
 * A task (stored as a "run"): a conversation with Claude in a folder — a
 * company repo (cloned through the VPN, a worktree of its own) or a folder
 * already on this machine — with a library agent and a model of its
 * choosing. The person can talk to it at any time; "Run workflow" carries
 * its ticket through the seven steps in that same conversation, each step
 * Claude does taking the Workflow page's agent and model when set.
 *
 * The seven steps: Until Jira is allowed,
 * the ticket is typed in by hand (key, title, description) and the steps that
 * would touch Jira — writing the plan to it, moving it — are done by the
 * person, the app showing what to paste and keeping a tick.
 *
 * Steps 1–2 are one Claude session in the run's worktree, with read-only
 * tools: it studies the code and answers with the analysis and the plan.
 * Step 3 is the person's: approve, ask for changes (the same session revises
 * the plan), or skip.
 *
 * Step 4: the same session, now with tools that edit and run commands (never
 * git commit/push — the app does that in step 6), fixes it on a branch of
 * its own. Step 5: the repo's test command (Settings, per repo), or — with
 * none set — Claude runs the tests and gives a verdict. A failure goes back
 * to step 4 with what failed, up to the run's rounds; past them it waits for
 * the person. Steps 6–7 come in M5.
 */

export type StepId = 'analyze' | 'plan' | 'review' | 'fix' | 'test' | 'selfReview' | 'pr' | 'humanReview';
export type StepState = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';

export const STEPS: StepId[] = ['analyze', 'plan', 'review', 'fix', 'test', 'selfReview', 'pr', 'humanReview'];

export type ManualTicket = { key: string; title: string; description: string; url: string | null };

export type RunEvent = {
  at: string;
  kind: 'text' | 'tool' | 'system' | 'error' | 'you';
  text: string;
};

export type Run = {
  id: string;
  ticket: ManualTicket;
  /** Where it works: a company repo (owner/name) or a folder on this machine — 'none' until a new task's is picked. */
  source: 'repo' | 'folder' | 'none';
  repo: string;
  folder: string | null;
  /** The task's library agent and model (null: plain Claude Code, the default model). */
  agent: string | null;
  model: string | null;
  /** Which AI does the work: Claude (Claude Code) or GitHub Copilot. */
  engine: 'claude' | 'copilot';
  /** Copilot's own conversation, kept apart from Claude's (sessionId). */
  copilotSessionId: string | null;
  /** "Run workflow" pressed: the steps are under way. */
  workflowStarted: boolean;
  baseBranch: string | null;
  createdAt: string;
  updatedAt: string;
  steps: Record<StepId, StepState>;
  /** Skip step 3: approve the plan as soon as it's written. */
  autoApprove: boolean;
  /** The current plan (Markdown), and earlier ones with the feedback that replaced them. */
  plan: string | null;
  revisions: { at: string; plan: string; feedback: string }[];
  /** Step 2 done by hand: the plan was pasted into the ticket. */
  planInTicket: boolean;
  sessionId: string | null;
  /** The fix's branch (step 4). */
  branch: string | null;
  /** Step 4 by hand: the ticket moved to In progress. */
  movedInProgress: boolean;
  /** How step 5 tests: a shell command, or '' for Claude to run them. */
  testCommand: string;
  /** Build / lint / typecheck, run before the tests ('' for none). */
  checkCommand: string;
  /** The checks and tests on the untouched base, before the fix — what already failed there. */
  baseline: Baseline | null;
  /** Step 5½: another Claude's review of the diff, round by round. */
  selfReviews: SelfReview[];
  /** Who is working on it now: the main agent of the turn under way (null between turns). */
  current: { agent: string; model: string | null; step: string; startedAt: string } | null;
  /** The subagents Claude started in this task (latest last). */
  agents: AgentActivity[];
  /** Fix rounds allowed before step 5 waits for the person, and those done. */
  maxRounds: number;
  round: number;
  /** Claude's account of the fix, latest round. */
  fixSummary: string | null;
  tests: TestResult[];
  /**
   * A folder that is a git repo with a GitHub origin is worked in a worktree
   * of its own (under the app's data), branched from origin's base — the
   * person's checkout is never switched or touched.
   */
  linked: boolean;
  /** The base branch asked for (else the repo's default). */
  requestedBase: string | null;
  /** Step 6's pull request, and step 7's review feedback. */
  pr: PullRequest | null;
  feedback: Feedback[];
  /** Step 6 by hand: the ticket moved to Review. */
  movedToReview: boolean;
  /** After the PR was closed or merged: the task's branch deleted (on GitHub and here). */
  branchDeleted: boolean;
  error: string | null;
  events: RunEvent[];
};

export type TestResult = {
  round: number;
  at: string;
  passed: boolean;
  by: 'command' | 'claude';
  /** The command's output (its end), or Claude's report. */
  output: string;
  /**
   * A failure, sorted: the change broke it (back to the fix); it failed the
   * same on the base (counts as a pass); or the environment (missing
   * service, credentials, network) — the person's to sort out.
   */
  kind?: 'new' | 'preExisting' | 'env' | null;
  why?: string | null;
};

export type CommandRun = { ok: boolean; output: string };

/** A subagent Claude started (the Agent tool), as it runs and after. */
export type AgentActivity = {
  /** The Agent tool call's id. */
  id: string;
  name: string;
  description: string;
  /** Which step (or the conversation) started it. */
  step: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startedAt: string;
  endedAt: string | null;
  lastTool: string | null;
  toolUses: number;
};
export type Baseline = { at: string; base: string; check: CommandRun | null; test: CommandRun | null };

export type SelfReview = {
  round: number;
  at: string;
  verdict: 'approve' | 'changes';
  /** The reviewer's findings (Markdown). */
  report: string;
  /** Files changed that the plan doesn't name. */
  outOfPlan: string[];
  /** Lines added that look like secrets (file: what). */
  secrets: string[];
};

/** Fields added after a run was saved get their defaults. */
function upgrade(r: Run): Run {
  return {
    ...r,
    source: r.source ?? 'repo',
    engine: r.engine ?? 'claude',
    copilotSessionId: r.copilotSessionId ?? null,
    folder: r.folder ?? null,
    agent: r.agent ?? null,
    model: r.model ?? null,
    workflowStarted: r.workflowStarted ?? r.steps.analyze !== 'pending',
    branch: r.branch ?? null,
    movedInProgress: r.movedInProgress ?? false,
    testCommand: r.testCommand ?? '',
    checkCommand: r.checkCommand ?? '',
    baseline: r.baseline ?? null,
    selfReviews: r.selfReviews ?? [],
    // Nothing runs across a restart.
    current: null,
    agents: (r.agents ?? []).map((a) => (a.status === 'running' ? { ...a, status: 'stopped' as const, endedAt: a.endedAt ?? new Date().toISOString() } : a)),
    steps: { ...r.steps, selfReview: r.steps.selfReview ?? (r.steps.pr !== 'pending' ? 'skipped' : 'pending') },
    maxRounds: r.maxRounds ?? 3,
    round: r.round ?? 0,
    fixSummary: r.fixSummary ?? null,
    tests: r.tests ?? [],
    linked: r.linked ?? false,
    requestedBase: r.requestedBase ?? null,
    pr: r.pr ?? null,
    feedback: r.feedback ?? [],
    movedToReview: r.movedToReview ?? false,
    branchDeleted: r.branchDeleted ?? false,
  };
}

// ---- Storage ----------------------------------------------------------------

const dir = () => {
  const d = dataPath('runs');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const file = (id: string) => `${dir()}/${id}.json`;
const runs = new Map<string, Run>();
let loaded = false;

function loadAll(): void {
  if (loaded) return;
  loaded = true;
  for (const f of fs.readdirSync(dir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = upgrade(JSON.parse(fs.readFileSync(`${dir()}/${f}`, 'utf8')) as Run);
      // A run the app was closed in the middle of stops there.
      for (const s of STEPS) if (r.steps[s] === 'running') {
        r.steps[s] = 'failed';
        r.error = 'FJ AI Worker was closed while this step ran — run it again';
      }
      runs.set(r.id, r);
    } catch {
      // a damaged file is left alone
    }
  }
}

let notify: (run: Run) => void = () => {};
export function onRunChange(fn: (run: Run) => void): void {
  notify = fn;
}

function save(r: Run): void {
  r.updatedAt = new Date().toISOString();
  runs.set(r.id, r);
  fs.writeFileSync(`${file(r.id)}.tmp`, JSON.stringify(r, null, 2));
  fs.renameSync(`${file(r.id)}.tmp`, file(r.id));
  notify(r);
}

function log(r: Run, kind: RunEvent['kind'], text: string, persist = true): void {
  r.events.push({ at: new Date().toISOString(), kind, text });
  if (r.events.length > 2000) r.events.splice(0, r.events.length - 2000);
  if (persist) save(r);
}

export function listRuns(): Run[] {
  loadAll();
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRun(id: string): Run {
  loadAll();
  const r = runs.get(id);
  if (!r) throw new Error('No such run');
  return r;
}

// ---- Creating and steering --------------------------------------------------

export type NewRun = {
  ticket: ManualTicket;
  repo?: string;
  folder?: string;
  agent?: string | null;
  model?: string | null;
  autoApprove?: boolean;
  testCommand?: string;
  maxRounds?: number;
  /** Start the seven steps now (else it's a conversation until "Run workflow"). */
  startWorkflow?: boolean;
  /** A blank task, as a new session in AI Office: its place, agent and brief come after. */
  draft?: boolean;
  /** The branch to start from (else the repo's default). */
  base?: string;
  checkCommand?: string;
  engine?: 'claude' | 'copilot';
};

const slugId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'task';

export function createRun(input: NewRun): Run {
  loadAll();
  const key = input.ticket.key.trim().toUpperCase();
  const title = input.ticket.title.trim();
  if (!key && !title && !input.draft) throw new Error('Give the task a name, or its ticket key');
  const repo = (input.repo ?? '').trim();
  const folder = (input.folder ?? '').trim();
  if (!repo && !folder && !input.draft) throw new Error('Pick a repo or a folder');
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('A repo is owner/name');
  if (!repo && folder && (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory())) throw new Error('That folder isn’t there');
  const wf = getSettings().workflow;
  const testCommand = (input.testCommand ?? (repo ? getSettings().repos[repo]?.testCommand : '') ?? '').trim();
  // Remembered for the repo's next task.
  if (repo && input.testCommand !== undefined) saveSettings({ repos: { [repo]: { testCommand } } });
  const now = new Date().toISOString();
  const r: Run = {
    id: `${slugId(key || title || 'task')}-${randomUUID().slice(0, 8)}`,
    ticket: { key, title, description: input.ticket.description.trim(), url: input.ticket.url?.trim() || null },
    source: repo ? 'repo' : folder ? 'folder' : 'none',
    repo,
    folder: !repo && folder ? path.resolve(folder) : null,
    agent: input.agent || null,
    model: input.model || null,
    engine: input.engine ?? 'claude',
    copilotSessionId: null,
    workflowStarted: false,
    baseBranch: null,
    createdAt: now,
    updatedAt: now,
    steps: Object.fromEntries(STEPS.map((s) => [s, 'pending'])) as Record<StepId, StepState>,
    autoApprove: input.autoApprove ?? !wf.review.enabled,
    plan: null,
    revisions: [],
    planInTicket: false,
    sessionId: null,
    branch: null,
    movedInProgress: false,
    testCommand,
    checkCommand: (input.checkCommand ?? (repo ? getSettings().repos[repo]?.checkCommand : '') ?? '').trim(),
    baseline: null,
    selfReviews: [],
    current: null,
    agents: [],
    maxRounds: Math.min(10, Math.max(1, Math.round(input.maxRounds ?? wf.test.rounds))),
    round: 0,
    fixSummary: null,
    tests: [],
    linked: false,
    requestedBase: input.base?.trim() || null,
    pr: null,
    feedback: [],
    movedToReview: false,
    branchDeleted: false,
    error: null,
    events: [],
  };
  save(r);
  if (input.startWorkflow) void startWorkflowNow(r);
  else if (r.source !== 'none') prepareOnly(r);
  return r;
}

/** Where a task works — set (or changed) until Claude has started in it. */
export function setTaskPlace(id: string, place: { repo?: string; folder?: string; base?: string }): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  if (r.sessionId || r.branch) throw new Error('Claude has already worked here — start a new task to work somewhere else');
  const repo = (place.repo ?? '').trim();
  const folder = (place.folder ?? '').trim();
  if (repo) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('A repo is owner/name');
    if (r.source === 'repo' && r.repo !== repo) void removeWorktree(r.id, r.repo).catch(() => {});
    Object.assign(r, { source: 'repo', repo, folder: null, baseBranch: null });
    r.testCommand ||= getSettings().repos[repo]?.testCommand ?? '';
  } else if (folder) {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('That folder isn’t there');
    if (r.source === 'repo') void removeWorktree(r.id, r.repo).catch(() => {});
    Object.assign(r, { source: 'folder', repo: '', folder: path.resolve(folder), baseBranch: null, linked: false });
  } else throw new Error('Pick a repo or a folder');
  if (place.base !== undefined) r.requestedBase = place.base.trim() || null;
  r.error = null;
  save(r);
  prepareOnly(r);
  return r;
}

/** The task's ticket: key, title, description, link. */
export function setTicket(id: string, patch: Partial<ManualTicket>): Run {
  const r = getRun(id);
  const t = { ...r.ticket, ...patch };
  r.ticket = { key: t.key.trim().toUpperCase(), title: t.title.trim(), description: t.description.trim(), url: t.url?.trim() || null };
  save(r);
  return r;
}

/** The folder Claude works in. */
export function workDir(r: Run): string {
  return r.source === 'folder' && r.folder && !r.linked ? r.folder : worktreeDir(r.id);
}

/** The base the fix is measured against: origin's branch for a repo (or a linked folder), the local one for a plain folder. */
const baseRef = (r: Run) => (r.source === 'repo' || r.linked ? `origin/${r.baseBranch}` : r.baseBranch!);

/** git for the task: the app's (its own clone, its token) or the person's own (their repo, their credentials). */
const gitFor = (r: Run) => (r.source === 'folder' ? gitLocal : git);

async function isGitRepo(dir: string): Promise<boolean> {
  return git(['rev-parse', '--is-inside-work-tree'], dir)
    .then((o) => o.trim() === 'true')
    .catch(() => false);
}

const preparing = new Map<string, Promise<void>>();

/**
 * The checkout ready (a repo cloned or fetched, its worktree made), and the
 * base branch known. One at a time per task: a message or a step that comes
 * while it's under way waits for the same one.
 */
function prepare(r: Run): Promise<void> {
  let p = preparing.get(r.id);
  if (!p) {
    p = prepareNow(r).finally(() => preparing.delete(r.id));
    preparing.set(r.id, p);
  }
  return p;
}

async function prepareNow(r: Run): Promise<void> {
  if (r.source === 'none') throw new Error('Pick where this task works first — a repo or a folder (under the message box)');
  if (r.source === 'folder') {
    if (!r.folder || !fs.existsSync(r.folder)) throw new Error(`The folder ${r.folder} isn’t there`);
    const origin = (await isGitRepo(r.folder)) ? await localOrigin(r.folder) : null;
    if (!origin) {
      // Not a GitHub repo: Claude works in the folder as it is.
      if (!r.baseBranch && (await isGitRepo(r.folder))) r.baseBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], r.folder)).trim();
      return;
    }
    // A GitHub repo of the person's: a worktree of the task's own, from
    // origin's base fetched now — their checkout stays as it is.
    r.linked = true;
    if (r.baseBranch && fs.existsSync(worktreeDir(r.id))) return;
    let base = r.requestedBase;
    if (!base) {
      const head = await gitLocal(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], r.folder).catch(() => '');
      base = head.trim().replace('refs/remotes/origin/', '') || 'main';
    }
    log(r, 'system', `Fetching origin/${base} (${origin.slug}) through the VPN…`);
    await gitLocal(['fetch', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], r.folder, 900000);
    const wt = worktreeDir(r.id);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    await gitLocal(['worktree', 'add', '--detach', wt, `origin/${base}`], r.folder, 900000);
    r.baseBranch = base;
    log(r, 'system', `Checked out origin/${base} in a worktree of its own (${wt}) — ${r.folder} itself is untouched.`);
    return;
  }
  if (r.baseBranch && fs.existsSync(worktreeDir(r.id))) return;
  log(r, 'system', `Getting ${r.repo} from GitHub…`);
  r.baseBranch ??= (await syncRepo(r.repo)).defaultBranch;
  const wt = await createWorktree(r.id, r.repo, r.baseBranch);
  log(r, 'system', `Checked out ${r.baseBranch} at ${wt}`);
}

/** A new task without the workflow: its checkout made ready, for talking to Claude in. */
function prepareOnly(r: Run): void {
  prepare(r)
    .catch((e) => {
      r.error = e instanceof Error ? e.message : String(e);
      log(r, 'error', r.error, false);
    })
    .finally(() => save(r));
}

/** "Run workflow": the seven steps from the start. */
export function startWorkflow(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  if (r.source === 'none') throw new Error('Pick where this task works first — a repo or a folder');
  if (!r.ticket.title && !r.ticket.description) throw new Error('Give the task its ticket first (what it is about)');
  if (r.workflowStarted && r.steps.analyze !== 'failed') throw new Error('The workflow is already under way');
  void startWorkflowNow(r);
  return r;
}

function startWorkflowNow(r: Run): Promise<void> {
  r.workflowStarted = true;
  return analyse(r);
}

/** The task's own agent and model, for its conversation (and steps with none of their own). */
export function setTaskOptions(id: string, opts: { agent?: string | null; model?: string | null; engine?: 'claude' | 'copilot' }): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for it to finish');
  if ('agent' in opts) r.agent = opts.agent || null;
  if ('model' in opts) r.model = opts.model || null;
  if (opts.engine && opts.engine !== r.engine) {
    r.engine = opts.engine;
    // Each AI's models are its own.
    r.model = null;
    log(r, 'system', `From here on ${opts.engine === 'copilot' ? 'GitHub Copilot' : 'Claude'} does the work — it starts its own conversation, with the task's brief.`, false);
  }
  save(r);
  return r;
}

/** A message from the person, at any point: Claude answers in the same conversation (and may change files). */
export function sendMessage(id: string, text: string): Run {
  const r = getRun(id);
  const msg = text.trim();
  if (!msg) throw new Error('Write something');
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  void chat(r, msg);
  return r;
}

async function chat(r: Run, text: string): Promise<void> {
  let abort: AbortController;
  try {
    abort = claim(r);
  } catch {
    return;
  }
  // A blank task's first message is its brief (and its first line its title).
  if (!r.sessionId && !r.ticket.description && !r.workflowStarted) {
    r.ticket.description = text;
    if (!r.ticket.title) r.ticket.title = text.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  log(r, 'you', text);
  try {
    if (r.engine !== 'copilot') await assertClaudeAccount();
    await prepare(r);
    await claudeTurn(r, abort, {
      prompt: r.sessionId ? text : `${taskContext(r)}\n\n---\n${text}`,
      resume: r.sessionId,
      step: 'chat',
      role: 'helping with this task in this folder. Change files only inside it; never commit, push or switch branches',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Skill', 'WebFetch', 'WebSearch', 'Agent'],
      canUseTool: fixPermissions(r),
      maxTurns: 200,
    });
  } catch (e) {
    r.error = abort.signal.aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    log(r, 'error', r.error, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
}

/** What the task is, for the first message Claude gets in it. */
function taskContext(r: Run): string {
  const t = r.ticket;
  const where =
    r.source === 'repo'
      ? `the ${r.repo} repository (checked out at ${r.baseBranch ?? 'its default branch'}, in the current folder)`
      : `the folder ${r.folder} (the current folder)`;
  return [
    `You are working on ${t.key ? `ticket ${t.key}` : 'a task'} in ${where}.`,
    '',
    `# ${t.key ? `${t.key}: ` : ''}${t.title || '(no title)'}`,
    t.url ? `Ticket: ${t.url}` : '',
    '',
    t.description || '(no description)',
  ].join('\n');
}

const live = new Map<string, AbortController>();

function claim(r: Run): AbortController {
  if (live.has(r.id)) throw new Error('Already running');
  const abort = new AbortController();
  live.set(r.id, abort);
  r.error = null;
  return abort;
}

export function isRunning(id: string): boolean {
  return live.has(id);
}

export function stopRun(id: string): Run {
  live.get(id)?.abort();
  return getRun(id);
}

export async function deleteRun(id: string): Promise<void> {
  const r = getRun(id);
  live.get(id)?.abort();
  // A folder of the person's own stays; only the app's own checkout goes.
  if (r.source === 'repo') await removeWorktree(id, r.repo);
  else if (r.linked && r.folder) {
    // The task's worktree goes; its branch (pushed, with its PR) stays in the repo.
    await gitLocal(['worktree', 'remove', '--force', worktreeDir(id)], r.folder).catch(() => fs.rmSync(worktreeDir(id), { recursive: true, force: true }));
    await gitLocal(['worktree', 'prune'], r.folder).catch(() => {});
  }
  runs.delete(id);
  fs.rmSync(file(id), { force: true });
}

/** Step 2 by hand: the plan is in the ticket (or not, undone). */
export function setPlanInTicket(id: string, done: boolean): Run {
  const r = getRun(id);
  r.planInTicket = done;
  save(r);
  return r;
}

/** Step 3. */
export function reviewPlan(id: string, decision: { kind: 'approve' } | { kind: 'skip' } | { kind: 'changes'; feedback: string }): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  if (!r.plan) throw new Error('There is no plan yet');
  if (decision.kind === 'changes') {
    const feedback = decision.feedback.trim();
    if (!feedback) throw new Error('Say what to change');
    r.revisions.push({ at: new Date().toISOString(), plan: r.plan, feedback });
    r.planInTicket = false;
    log(r, 'you', feedback, false);
    void analyse(r, feedback);
    return r;
  }
  r.steps.review = decision.kind === 'approve' ? 'done' : 'skipped';
  log(r, 'system', decision.kind === 'approve' ? 'Plan approved.' : 'Plan review skipped.', false);
  save(r);
  void fix(r);
  return r;
}

/** Step 4 by hand: the ticket is In progress in Jira (or not, undone). */
export function setMovedInProgress(id: string, done: boolean): Run {
  const r = getRun(id);
  r.movedInProgress = done;
  save(r);
  return r;
}

/** How step 5 tests, from now on (and for the repo's next run). */
export function setTestCommand(id: string, command: string): Run {
  const r = getRun(id);
  r.testCommand = command.trim();
  rememberCommands(r);
  save(r);
  return r;
}

/** Build / lint / typecheck before the tests, from now on (and for the repo's next task). */
export function setCheckCommand(id: string, command: string): Run {
  const r = getRun(id);
  r.checkCommand = command.trim();
  rememberCommands(r);
  save(r);
  return r;
}

/** A repo's (or folder's) test and check commands, for its next task. */
function rememberCommands(r: Run): void {
  const key = r.source === 'repo' ? r.repo : r.folder;
  if (key) saveSettings({ repos: { [key]: { testCommand: r.testCommand, checkCommand: r.checkCommand } } });
}

/** Past the rounds (or after a failure): another fix round, with what last failed. */
export function retryFix(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Already running');
  if (r.steps.review !== 'done' && r.steps.review !== 'skipped') throw new Error('The plan isn’t approved yet');
  const last = r.tests.at(-1);
  void fix(r, last && !last.passed ? last : undefined, true);
  return r;
}

/** Step 5 again, without changing anything. */
export function retryTests(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Already running');
  if (r.steps.fix !== 'done') throw new Error('Fix it first (step 4)');
  void runTests(r);
  return r;
}

/** Tests failing, but the person goes on anyway. */
export function acceptTests(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for it to finish');
  r.steps.test = 'skipped';
  log(r, 'system', 'Tests accepted as they are — going on.', false);
  save(r);
  afterTests(r);
  return r;
}

/** Step 1 again from the start (after a failure, or for a fresh look). */
export function rerunAnalysis(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Already running');
  r.workflowStarted = true;
  void analyse(r);
  return r;
}

// ---- Steps 1–2: Claude studies the code and writes the plan -----------------

const PLAN_FORMAT = `Reply with exactly these sections, in Markdown:

## Analysis
What the ticket asks for, what you found in the code (files, functions, the cause if it's a bug), and anything unclear.

## Plan
Numbered steps to fix it: which files change and how, what tests to add or update, and how to check the fix.

## Risks
What could break, and anything the reviewer should decide (or "None").`;

function firstPrompt(r: Run): string {
  return [
    taskContext(r),
    '',
    '---',
    'Step 1 — analyse: read the code that matters to this task until you understand it. Do not change any files; your tools are read-only.',
    'Step 2 — plan: write the plan to do it, for a reviewer to approve before anyone changes code.',
    '',
    PLAN_FORMAT,
  ].join('\n');
}

const revisePrompt = (feedback: string) =>
  `The reviewer asked for changes to the plan:\n\n${feedback}\n\nLook at the code again where you need to, and reply with the revised plan in the same format.\n\n${PLAN_FORMAT}`;

/** One line for a tool call in the run's log. */
function describeTool(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Read':
      return `Read ${s('file_path')}`;
    case 'Grep':
      return `Search “${s('pattern')}”${s('path') ? ` in ${s('path')}` : ''}`;
    case 'Glob':
      return `Find ${s('pattern')}`;
    case 'Edit':
      return `Edit ${s('file_path')}`;
    case 'Write':
      return `Write ${s('file_path')}`;
    case 'Bash':
      return `$ ${s('command').split('\n')[0].slice(0, 200)}`;
    case 'TodoWrite':
      return 'Update its to-do list';
    case 'Agent':
      return `Start the ${s('subagent_type') || 'general-purpose'} agent: ${s('description')}`;
    default:
      return name;
  }
}

async function analyse(r: Run, feedback?: string): Promise<void> {
  let abort: AbortController;
  try {
    abort = claim(r);
  } catch {
    return;
  }
  r.steps.analyze = feedback ? r.steps.analyze : 'running';
  r.steps.plan = 'running';
  r.steps.review = 'pending';
  save(r);
  try {
    if (r.engine !== 'copilot') await assertClaudeAccount();
    await prepare(r);
    // Revising: the same conversation. Starting: the task's conversation so far,
    // if the person already talked to Claude in it.
    const resume = r.sessionId;
    const result = await claudeTurn(r, abort, {
      prompt: feedback && resume ? revisePrompt(feedback) : firstPrompt(r),
      resume,
      step: 'analyse',
      role: 'analysing a ticket before any code is changed. Only read; never try to edit, write or run commands',
      // Read-only: these exist, nothing else does.
      tools: ['Read', 'Grep', 'Glob', 'Skill', 'Agent'],
      maxTurns: 80,
      onText: (text) => {
        if (r.steps.analyze === 'running' && /##\s*Plan/.test(text)) r.steps.analyze = 'done';
      },
    });
    if (!result || !/##\s*Plan/i.test(result)) throw new Error('Claude did not write a plan');
    r.plan = result.trim();
    r.steps.analyze = 'done';
    r.steps.plan = 'done';
    if (r.autoApprove) {
      r.steps.review = 'skipped';
      log(r, 'system', 'Plan written. Review skipped (set when the run started).', false);
    } else {
      r.steps.review = 'waiting';
      log(r, 'system', 'Plan written — waiting for review.', false);
    }
  } catch (e) {
    const aborted = abort.signal.aborted;
    const msg = aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    r.error = msg;
    for (const s of ['analyze', 'plan'] as const) if (r.steps[s] === 'running') r.steps[s] = 'failed';
    log(r, 'error', msg, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
  if (r.autoApprove && r.steps.review === 'skipped' && !r.error) void fix(r);
}

// ---- Claude, one turn ---------------------------------------------------------

type Turn = {
  prompt: string;
  resume: string | null;
  /** Which step (or the conversation), for the Workflow page's agent and model. */
  step: 'analyse' | 'fix' | 'test' | 'selfReview' | 'chat';
  /**
   * A side conversation (a fresh reviewer, a quick classification): not the
   * task's own — its session isn't kept, its words aren't in the task's
   * conversation, it collects no artifacts.
   */
  ephemeral?: boolean;
  /** This model, whatever the step's or the task's. */
  model?: string;
  /** What it's doing, for the system prompt. */
  role: string;
  tools: string[];
  canUseTool?: CanUseTool;
  maxTurns: number;
  onText?: (text: string) => void;
};

/** One prompt to Claude in the run's worktree, logged as it goes; resolves with its final reply. */
async function claudeTurn(r: Run, abort: AbortController, t: Turn): Promise<string> {
  const cfg: StepAgent | null = t.step === 'chat' ? null : getSettings().workflow[t.step];
  // A fresh reviewer doesn't wear the task's agent — only one picked for the review.
  const agentName = cfg?.agent || (t.ephemeral ? null : r.agent);
  const model = t.model || cfg?.model || r.model;
  const note = projectNote(await taskProject(r).catch(() => null));
  const rules = `You are FJ AI Worker, ${t.role}.${note ? `\n\nProject context (kept by the team in FJ AI Worker — follow it):\n\n${note.text}` : ''}`;
  const def = agentName ? agentDefinition(agentName) : null;
  if (agentName && !def) log(r, 'system', `The agent ${agentName} isn’t in the library any more — going on without it.`, false);
  // A subagent waits for its result in the turn: the turn (and its process)
  // mustn't end with one still running in the background.
  const vet = t.canUseTool ?? (async (_tool, input) => ({ behavior: 'allow' as const, updatedInput: input }));
  const canUseTool: CanUseTool = async (tool, input, opts) => {
    const res = await vet(tool, input, opts);
    if (tool === 'Agent' && res && res.behavior === 'allow') return { behavior: 'allow', updatedInput: { ...(res.updatedInput ?? input), run_in_background: false } };
    return res;
  };
  const stepName = t.step === 'chat' ? 'conversation' : t.step;
  if (!t.ephemeral) {
    r.current = {
      agent: def && agentName ? agentName : r.engine === 'copilot' ? 'GitHub Copilot' : 'Claude Code',
      model: model ?? null,
      step: stepName,
      startedAt: new Date().toISOString(),
    };
    save(r);
  }
  /** The subagents this turn started, by their Agent call's id. */
  const subs = new Map<string, AgentActivity>();
  const endSub = (id: string, status: AgentActivity['status']) => {
    const a = subs.get(id) ?? r.agents.find((x) => x.id === id);
    if (a && a.status === 'running') {
      a.status = status;
      a.endedAt = new Date().toISOString();
    }
  };
  let result: string | null = null;
  // For the Artifacts page: what it wrote, and since when.
  const since = Date.now() - 1000;
  const written: string[] = [];
  try {
    if (r.engine === 'copilot') {
      result = await copilotRun(r, abort, t, { rules, agentName: def && agentName ? agentName : null, model, stepName, subs, endSub, written });
    } else {
      const stream = query({
        prompt: t.prompt,
        options: {
          cwd: workDir(r),
          env: { ...claudeEnv(), ...note?.env },
          ...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable()! } : {}),
          // A library agent runs the conversation with its own prompt (and the
          // step's rules after it); otherwise Claude Code's own, with the rules.
          ...(def && agentName
            ? { agents: { [agentName]: { ...def, prompt: `${def.prompt}\n\n${rules}` } }, agent: agentName }
            : { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: rules } }),
          ...(model ? { model } : {}),
          tools: t.tools,
          canUseTool,
          // The app's own Claude folder (claude-account.ts): the imported skills
          // and agents — nothing of the person's own ~/.claude.
          settingSources: ['user'],
          maxTurns: t.maxTurns,
          abortController: abort,
          ...(t.resume ? { resume: t.resume } : {}),
        },
      });
      for await (const m of stream as AsyncIterable<SDKMessage>) {
        if (m.type === 'assistant' && m.parent_tool_use_id) {
          // A subagent's own work: its tool calls go to its row (and the log, marked).
          const a = subs.get(m.parent_tool_use_id);
          for (const b of m.message.content) {
            if (b.type !== 'tool_use') continue;
            const line = describeTool(b.name, (b.input ?? {}) as Record<string, unknown>);
            if (a) {
              a.lastTool = line;
              a.toolUses++;
            }
            if (!t.ephemeral) log(r, 'tool', `↳ ${a?.name ?? 'subagent'}: ${line}`, false);
          }
          save(r);
        } else if (m.type === 'user' && !m.parent_tool_use_id && Array.isArray(m.message.content)) {
          // A subagent's result back in the main conversation: it's done.
          for (const b of m.message.content as { type: string; tool_use_id?: string; is_error?: boolean }[]) {
            if (b.type === 'tool_result' && b.tool_use_id && subs.has(b.tool_use_id)) endSub(b.tool_use_id, b.is_error ? 'failed' : 'completed');
          }
          save(r);
        } else if (m.type === 'system' && (m.subtype === 'task_progress' || m.subtype === 'task_notification')) {
          const id = m.tool_use_id;
          if (id && subs.has(id)) {
            if (m.subtype === 'task_notification') endSub(id, m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'stopped');
            else if (m.last_tool_name) subs.get(id)!.lastTool = subs.get(id)!.lastTool ?? m.last_tool_name;
            save(r);
          }
        } else if (m.type === 'assistant') {
          if (m.session_id && !t.ephemeral) r.sessionId = m.session_id;
          for (const b of m.message.content) {
            if (b.type === 'tool_use' && b.name === 'Agent') {
              const input = (b.input ?? {}) as { subagent_type?: string; description?: string };
              const a: AgentActivity = {
                id: b.id,
                name: input.subagent_type || 'general-purpose',
                description: input.description ?? '',
                step: stepName,
                status: 'running',
                startedAt: new Date().toISOString(),
                endedAt: null,
                lastTool: null,
                toolUses: 0,
              };
              subs.set(b.id, a);
              if (!t.ephemeral) {
                r.agents.push(a);
                if (r.agents.length > 60) r.agents.splice(0, r.agents.length - 60);
              }
            }
          }
          for (const b of m.message.content) {
            if (b.type === 'text' && b.text.trim()) {
              if (!t.ephemeral) log(r, 'text', b.text, false);
              t.onText?.(b.text);
            } else if (b.type === 'tool_use') {
              const input = (b.input ?? {}) as Record<string, unknown>;
              log(r, 'tool', describeTool(b.name, input), false);
              if ((b.name === 'Write' || b.name === 'Edit') && typeof input.file_path === 'string') written.push(input.file_path);
            }
          }
          save(r);
        } else if (m.type === 'result') {
          if (m.subtype === 'success' && !m.is_error) result = m.result;
          else if (m.subtype === 'error_max_turns') throw new Error('Claude ran out of turns before finishing');
          else throw new Error(m.subtype === 'success' ? m.result : `Claude stopped (${m.subtype})`);
        }
      }
    }
  } finally {
    // Whatever was still running when the turn ended ended with it.
    for (const id of subs.keys()) endSub(id, abort.signal.aborted ? 'stopped' : 'completed');
    if (!t.ephemeral) r.current = null;
    if (!t.ephemeral) try {
      const wd = workDir(r);
      // A git checkout: only what git sees changed or new counts.
      const status = (await isGitRepo(wd)) ? await git(['status', '--porcelain=v1', '-uall'], wd).catch(() => null) : null;
      const changed = status == null ? null : new Set(status.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')));
      const n = collectArtifacts({ id: r.id, title: r.ticket.title || r.ticket.key || 'Task' }, wd, written, since, changed);
      if (n) log(r, 'system', `${n} document${n === 1 ? '' : 's'} kept in Artifacts.`, false);
    } catch {
      // keeping documents never fails the turn
    }
  }
  if (result == null) throw new Error(`${r.engine === 'copilot' ? 'Copilot' : 'Claude'} gave no answer`);
  return result;
}

/** Claude's model names mean nothing to Copilot: those fall back to its default. */
const copilotModel = (m: string | null | undefined) => (m && !['opus', 'sonnet', 'haiku', 'fable'].includes(m) ? m : null);

/** One line for a Copilot tool call in the log, in the same words as Claude's. */
function describeCopilotTool(name: string, a: Record<string, unknown>): string {
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  const file = s('path') || s('file_path') || s('filePath');
  if (/^(view|read|read_file|cat)$/.test(name)) return `Read ${file}`;
  if (/^(edit|str_replace|str_replace_editor|apply_patch|write|create|write_file)$/.test(name)) return `Edit ${file}`;
  if (/^(bash|shell|powershell|run_command)$/.test(name)) return `$ ${(s('command') || s('cmd')).split('\n')[0].slice(0, 200)}`;
  if (/^(grep|search|rg)$/.test(name)) return `Search “${s('pattern') || s('query')}”`;
  if (/^(glob|find|ls|list)$/.test(name)) return `Find ${s('pattern') || file}`;
  if (name === 'task') return `Agent ${s('agent_type') || s('agentType') || s('name') || 'subagent'}: ${s('description') || s('prompt').slice(0, 120)}`.replace(/: $/, '');
  return name;
}

/** A turn on GitHub Copilot: the same rules, log, subagent rows and files written as a Claude turn. */
async function copilotRun(
  r: Run,
  abort: AbortController,
  t: Turn,
  ctx: {
    rules: string;
    agentName: string | null;
    model: string | null;
    stepName: string;
    subs: Map<string, AgentActivity>;
    endSub: (id: string, status: AgentActivity['status']) => void;
    written: string[];
  },
): Promise<string> {
  const canEdit = t.tools.includes('Edit') || t.tools.includes('Write');
  const canRun = t.tools.includes('Bash');
  const agents = readLibrary()
    .agents.map((a) => {
      const def = agentDefinition(a.name);
      return def ? { name: a.name, description: def.description, prompt: ctx.agentName === a.name ? `${def.prompt}\n\n${ctx.rules}` : def.prompt } : null;
    })
    .filter((a): a is { name: string; description: string; prompt: string } => !!a);
  return copilotTurn({
    cwd: workDir(r),
    // Its first message carries the task's brief: Claude's conversation isn't Copilot's.
    prompt: (t.resume && r.copilotSessionId) || t.prompt.startsWith(taskContext(r).slice(0, 60)) ? t.prompt : `${taskContext(r)}\n\n---\n${t.prompt}`,
    resume: t.ephemeral ? null : t.resume ? r.copilotSessionId : null,
    model: copilotModel(t.model ?? ctx.model),
    system: ctx.rules,
    agents,
    agent: ctx.agentName,
    rules: {
      readOnly: !canEdit && !canRun,
      allowWrite: (p) => canEdit && insideWorktree(r, p),
      shellRefusal: (cmd) =>
        !canRun ? 'No commands in this step.' : FORBIDDEN_BASH.test(cmd) ? 'Leave git commits, branches, pushes and GitHub to FJ AI Worker — just change the files.' : null,
    },
    signal: abort.signal,
    events: {
      onSession: (id) => {
        if (!t.ephemeral) r.copilotSessionId = id;
      },
      onText: (text) => {
        if (!t.ephemeral) log(r, 'text', text, false);
        t.onText?.(text);
        save(r);
      },
      onTool: (name, args, parent) => {
        const line = describeCopilotTool(name, args);
        const file = (args.path ?? args.file_path) as string | undefined;
        if (/^(edit|str_replace|str_replace_editor|write|create|write_file)$/.test(name) && typeof file === 'string') ctx.written.push(file);
        const a = parent ? ctx.subs.get(parent) : undefined;
        if (a) {
          a.lastTool = line;
          a.toolUses++;
        }
        if (!t.ephemeral) log(r, 'tool', parent ? `↳ ${a?.name ?? 'subagent'}: ${line}` : line, false);
        save(r);
      },
      onSubagentStart: (id, name, description) => {
        const a: AgentActivity = { id, name, description, step: ctx.stepName, status: 'running', startedAt: new Date().toISOString(), endedAt: null, lastTool: null, toolUses: 0 };
        ctx.subs.set(id, a);
        if (!t.ephemeral) r.agents.push(a);
        save(r);
      },
      onSubagentEnd: (id, status) => {
        ctx.endSub(id, status);
        save(r);
      },
      onRefused: (what) => log(r, 'system', `Refused: ${what}`, false),
    },
  });
}

// ---- Step 4: the fix ----------------------------------------------------------

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

/** Inside the run's worktree (after resolving `..` and symlinks of the parent). */
function insideWorktree(r: Run, p: unknown): boolean {
  if (typeof p !== 'string' || !p) return false;
  const root = fs.realpathSync(workDir(r));
  const abs = path.resolve(root, p);
  let real = abs;
  try {
    real = fs.realpathSync(path.dirname(abs)) + path.sep + path.basename(abs);
  } catch {
    // a new folder: its path as written
  }
  const rel = path.relative(root, real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** git that changes history or reaches out stays the app's (step 6); so does gh. */
export const FORBIDDEN_BASH = /(^|[;&|(]\s*|\s)(git\s+(push|commit|reset|rebase|merge|checkout|switch|remote|clean|tag|stash|branch\s+-[dD])|gh\s)/;

function fixPermissions(r: Run): CanUseTool {
  return async (tool, input) => {
    if ((tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') && !insideWorktree(r, input.file_path ?? input.notebook_path)) {
      log(r, 'system', `Refused: ${tool} outside the checkout`, false);
      return { behavior: 'deny', message: 'Only files inside the repository checkout may be changed.' };
    }
    if (tool === 'Bash' && typeof input.command === 'string' && FORBIDDEN_BASH.test(input.command)) {
      log(r, 'system', `Refused: ${input.command.slice(0, 120)}`, false);
      return {
        behavior: 'deny',
        message: 'Leave git commits, branches, pushes and GitHub to FJ AI Worker — it commits and opens the pull request after the tests pass. Just change the files.',
      };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

const FIX_PROMPT = (r: Run) =>
  [
    `Step 4 — fix: the plan is approved. Make the change now, in this folder${r.branch ? ` (branch ${r.branch})` : ''}.`,
    '',
    '- Follow the plan; if something in it turns out wrong, do what is right and say why.',
    '- Add or update tests where the plan says so.',
    '- You may run commands (build, lint, tests) to check your work.',
    '- Do not commit, push, or switch branches — FJ AI Worker commits and opens the pull request after the tests pass.',
    '',
    'When you are done, reply with a short summary: what you changed (files) and how you checked it.',
  ].join('\n');

const RETRY_PROMPT = (r: Run, failed: TestResult) =>
  [
    `Step 5 — the tests failed (round ${failed.round} of ${r.maxRounds}). ${failed.by === 'command' ? `Output of \`${r.testCommand}\` (its end):` : 'What the test run reported:'}`,
    '',
    '```',
    failed.output.slice(-12000),
    '```',
    '',
    'Fix the cause in the code (not by weakening the tests, unless a test itself is wrong — then say so). Do not commit or push.',
    'Reply with a short summary of what you changed.',
  ].join('\n');

async function fix(r: Run, failed?: TestResult, byHand = false, review?: Feedback[], selfFix?: SelfReview): Promise<void> {
  let abort: AbortController;
  try {
    abort = claim(r);
  } catch {
    return;
  }
  r.steps.fix = 'running';
  r.steps.test = 'pending';
  save(r);
  try {
    if (r.engine !== 'copilot') await assertClaudeAccount();
    await prepare(r);
    const wt = workDir(r);
    if (!r.branch && (r.source === 'repo' || r.linked || (await isGitRepo(wt)))) {
      const words = slug(r.ticket.title || r.ticket.description) || 'change';
      let name = `fix/${r.ticket.key ? `${r.ticket.key}-` : ''}${words}`;
      // Never another task's branch: a name already there gets the task's own suffix.
      if ((await git(['branch', '--list', name], wt)).trim()) name = `${name}-${r.id.slice(-8)}`;
      await git(['switch', '-c', name], wt);
      r.branch = name;
      log(r, 'system', `On branch ${name}.${r.ticket.key ? ` Move ${r.ticket.key} to In progress in Jira.` : ''}`, false);
    }
    // Before the first change: the checks and tests on the base as it is, so a
    // failure later can be told apart from one that was already there.
    if (!r.baseline && (r.testCommand || r.checkCommand) && getSettings().workflow.test.enabled && getSettings().workflow.test.baseline) {
      log(r, 'system', `Running the ${r.checkCommand ? 'checks and ' : ''}tests on ${r.baseBranch ?? 'the base'} as it is, before any change (a baseline)…`, false);
      save(r);
      r.baseline = {
        at: new Date().toISOString(),
        base: r.baseBranch ?? '',
        check: r.checkCommand ? await runCommand(r.checkCommand, wt, abort.signal) : null,
        test: r.testCommand ? await runCommand(r.testCommand, wt, abort.signal) : null,
      };
      if (abort.signal.aborted) throw new Error('Stopped');
      const said = [r.baseline.check && `checks ${r.baseline.check.ok ? 'pass' : 'fail'}`, r.baseline.test && `tests ${r.baseline.test.ok ? 'pass' : 'fail'}`].filter(Boolean).join(', ');
      log(r, 'system', `Baseline on ${r.baseBranch}: ${said}.`, false);
    }
    if (selfFix) log(r, 'system', `Dealing with the review's findings (round ${selfFix.round}).`, false);
    if (review) log(r, 'system', `Dealing with ${review.length} review comment${review.length === 1 ? '' : 's'} on PR #${r.pr?.number}.`, false);
    else if (failed) log(r, 'system', `Round ${r.round + 1}: fixing what the tests found.`, false);
    else if (byHand) log(r, 'system', `Round ${r.round + 1}: another go at the fix.`, false);
    r.fixSummary = await claudeTurn(r, abort, {
      prompt: selfFix ? SELF_FIX_PROMPT(selfFix) : review ? REVIEW_PROMPT(r, review) : failed ? RETRY_PROMPT(r, failed) : FIX_PROMPT(r),
      resume: r.sessionId,
      step: 'fix',
      role: `fixing ${r.ticket.key || 'the task'} in this folder. Change files only inside it; never commit, push or switch branches`,
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Skill', 'Agent'],
      canUseTool: fixPermissions(r),
      maxTurns: 200,
    });
    r.steps.fix = 'done';
    log(r, 'system', 'Fix done — testing.', false);
  } catch (e) {
    const msg = abort.signal.aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    r.error = msg;
    r.steps.fix = 'failed';
    log(r, 'error', msg, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
  if (r.steps.fix !== 'done') return;
  if (getSettings().workflow.test.enabled) void runTests(r);
  else {
    r.steps.test = 'skipped';
    log(r, 'system', 'Tests are off in the workflow — skipped.', false);
    save(r);
    afterTests(r);
  }
}

// ---- Step 5: the tests --------------------------------------------------------

const KEEP_OUTPUT = 60000;

/** The test command in the checkout, through a login shell; resolves with its exit and output (its end). */
function runCommand(command: string, cwd: string, signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/zsh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const env = { ...baseToolEnv(), ...toolEnv('git'), ...toolEnv('claude'), CI: '1', FORCE_COLOR: '0' };
    execFile(shell, args, { cwd, env, signal, timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = [stdout, stderr].filter((t) => t && t.trim()).join('\n').trim();
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null;
      const tail = err ? `\n(${code != null ? `exit ${code}` : err.message})` : '';
      resolve({ ok: !err, output: (text.slice(-KEEP_OUTPUT) + tail).trim() });
    });
  });
}

const TEST_PROMPT = (r: Run) =>
  [
    'Step 5 — test: run the repository’s build/typecheck and the tests that cover your change (and the related suites), the way this project runs them.',
    `Do not change any files now. A failure that also happens on ${r.baseBranch ?? 'the base'} without your change (read the code and the failure to judge — don’t stash or switch branches) is not yours: say so and it counts as a pass.`,
    '',
    'Your reply must start with a line that is exactly "Verdict: PASS", "Verdict: FAIL" (your change breaks something) or "Verdict: ENV" (it can’t run here — a missing service, credentials, the network, a tool), then what you ran and what happened (the failures in full).',
  ].join('\n');

async function runTests(r: Run): Promise<void> {
  let abort: AbortController;
  try {
    abort = claim(r);
  } catch {
    return;
  }
  r.steps.test = 'running';
  save(r);
  const round = r.round + 1;
  try {
    let result: TestResult;
    if (r.testCommand || r.checkCommand) {
      // The checks (build / lint / typecheck) first; the tests only if they pass.
      const parts: string[] = [];
      let ok = true;
      if (r.checkCommand) {
        log(r, 'system', `Running ${r.checkCommand}`, false);
        save(r);
        const c = await runCommand(r.checkCommand, workDir(r), abort.signal);
        ok = c.ok;
        parts.push(`$ ${r.checkCommand}\n${c.output}`);
      }
      if (ok && r.testCommand && !abort.signal.aborted) {
        log(r, 'system', `Running ${r.testCommand}`, false);
        save(r);
        const t = await runCommand(r.testCommand, workDir(r), abort.signal);
        ok = t.ok;
        parts.push(`$ ${r.testCommand}\n${t.output}`);
      }
      if (abort.signal.aborted) throw new Error('Stopped');
      result = { round, at: new Date().toISOString(), passed: ok, by: 'command', output: parts.join('\n\n').slice(-KEEP_OUTPUT) };
      if (!ok) {
        const sorted = await classifyFailure(r, abort, result.output);
        result.kind = sorted.kind;
        result.why = sorted.why;
        if (sorted.kind === 'preExisting') result.passed = true;
      }
    } else {
      const reply = await claudeTurn(r, abort, {
        prompt: TEST_PROMPT(r),
        resume: r.sessionId,
        step: 'test',
        role: `testing the fix for ${r.ticket.key || 'the task'}. Run tests and read; do not change files, commit or push`,
        tools: ['Read', 'Grep', 'Glob', 'Bash', 'Skill', 'Agent'],
        canUseTool: fixPermissions(r),
        maxTurns: 60,
      });
      const verdict = /verdict:\s*(pass|fail|env)/i.exec(reply)?.[1]?.toLowerCase();
      result = {
        round,
        at: new Date().toISOString(),
        passed: verdict === 'pass',
        by: 'claude',
        output: reply.trim(),
        kind: verdict === 'env' ? 'env' : verdict === 'fail' ? 'new' : null,
      };
    }
    r.round = round;
    r.tests.push(result);
    if (result.passed) {
      r.steps.test = 'done';
      log(r, 'system', result.kind === 'preExisting' ? `Tests: the same failures as on ${r.baseBranch} before the change — counted as passing (round ${round}).` : `Tests passed (round ${round}).`, false);
    } else if (result.kind === 'env') {
      // Not the code's fault: another round of fixing wouldn't help.
      r.steps.test = 'waiting';
      log(r, 'error', `The tests couldn’t run properly here — ${result.why ?? 'the environment, not the change'}. Sort that out, then Test again — or go on anyway.`, false);
    } else if (round < r.maxRounds) {
      r.steps.test = 'failed';
      log(r, 'error', `Tests failed (round ${round} of ${r.maxRounds}) — back to the fix.`, false);
    } else {
      r.steps.test = 'waiting';
      log(r, 'error', `Tests still fail after ${round} rounds — your call: another round, or go on anyway.`, false);
    }
  } catch (e) {
    const msg = abort.signal.aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    r.error = msg;
    r.steps.test = 'failed';
    log(r, 'error', msg, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
  const last = r.tests.at(-1);
  if (r.steps.test === 'failed' && !r.error && last && !last.passed) void fix(r, last);
  if (r.steps.test === 'done') afterTests(r);
}

/**
 * Why the checks or tests failed: the change (back to the fix), the same as
 * on the base before it (not the change's doing), or the environment (a
 * service, a credential, the network) — a quick look by Claude at this run
 * next to the baseline.
 */
async function classifyFailure(r: Run, abort: AbortController, output: string): Promise<{ kind: 'new' | 'preExisting' | 'env'; why: string | null }> {
  const b = r.baseline;
  const baseText = b ? [b.check && `$ ${r.checkCommand} (exit ${b.check.ok ? 0 : 'non-zero'})\n${b.check.output}`, b.test && `$ ${r.testCommand} (exit ${b.test.ok ? 0 : 'non-zero'})\n${b.test.output}`].filter(Boolean).join('\n\n') : '';
  const prompt = [
    'Sort this failed check/test run into one of three kinds:',
    '- NEW: it fails because of the change being made (a failure that isn’t in the baseline, or one the change could cause).',
    '- PRE_EXISTING: the same failures happen on the base before any change (the baseline below), and nothing new failed.',
    '- ENV: it couldn’t run properly here — a missing service or database, credentials, the network, a missing tool or SDK, a timeout.',
    '',
    b ? `Baseline — the same commands on ${b.base} before the change:\n\`\`\`\n${baseText.slice(-9000)}\n\`\`\`` : 'There is no baseline run.',
    '',
    `This run, after the change:\n\`\`\`\n${output.slice(-9000)}\n\`\`\``,
    '',
    'Reply with exactly two lines: "Kind: NEW", "Kind: PRE_EXISTING" or "Kind: ENV"; then "Why: " and one short sentence.',
  ].join('\n');
  try {
    const reply = await claudeTurn(r, abort, {
      prompt,
      resume: null,
      step: 'test',
      ephemeral: true,
      model: 'haiku',
      role: 'sorting why a test run failed. Only read what you are given; answer in two lines',
      tools: [],
      maxTurns: 2,
    });
    const kind = /kind:\s*(new|pre_existing|env)/i.exec(reply)?.[1]?.toLowerCase();
    const why = /why:\s*(.+)/i.exec(reply)?.[1]?.trim() ?? null;
    const k = kind === 'pre_existing' ? 'preExisting' : kind === 'env' ? 'env' : 'new';
    log(r, 'system', `Failure sorted: ${k === 'new' ? 'caused by the change' : k === 'preExisting' ? 'already failing on the base' : 'the environment'}${why ? ` — ${why}` : ''}.`, false);
    return { kind: k, why };
  } catch {
    // Can't tell: treat it as the change's, as before.
    return { kind: 'new', why: null };
  }
}

// ---- Step 5½: another Claude reviews the diff ------------------------------------

/** Tests passed (or set aside): the review of the diff, if it's on; then step 6. */
function afterTests(r: Run): void {
  if (r.branch && getSettings().workflow.selfReview.enabled && r.steps.selfReview !== 'done') void selfReview(r);
  else {
    if (r.steps.selfReview === 'pending') r.steps.selfReview = 'skipped';
    toPullRequest(r);
  }
}

/** Paths a plan names (`src/a/b.ts`, `B.java`, `README.md`…). */
export function planPaths(plan: string | null): string[] {
  if (!plan) return [];
  return [...new Set([...plan.matchAll(/[\w./@-]*[\w-]\.[A-Za-z][\w]{0,6}\b/g)].map((m) => m[0].replace(/^\.\//, '')).filter((p) => /[/.]/.test(p) && !/^\d/.test(p)))];
}

/** The plan names this file: by its path, the end of its path, or its name. */
export function inPlan(file: string, named: string[]): boolean {
  const f = file.toLowerCase();
  const base = f.split('/').pop()!;
  return named.some((n) => {
    const p = n.toLowerCase();
    return f === p || f.endsWith(`/${p}`) || p.endsWith(`/${f}`) || (!p.includes('/') && p === base);
  });
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/xox[abpr]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/sk-(ant-)?[A-Za-z0-9_-]{32,}/, 'an API key'],
  [/https?:\/\/[^\s/:@]+:[^\s/@]{6,}@/, 'a password in a URL'],
  [/(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i, 'a hard-coded secret'],
];

/** Secrets in the lines the change adds (file: what). */
export function findSecrets(diff: string): string[] {
  const hits: string[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      // One finding a line: the most specific pattern it matches.
      const hit = SECRET_PATTERNS.find(([re]) => re.test(line));
      if (hit) hits.push(`${file}: ${hit[1]}`);
    }
  }
  return [...new Set(hits)];
}

async function selfReview(r: Run): Promise<void> {
  let abort: AbortController;
  try {
    abort = claim(r);
  } catch {
    return;
  }
  r.steps.selfReview = 'running';
  save(r);
  const round = r.selfReviews.length + 1;
  const max = getSettings().workflow.selfReview.rounds;
  try {
    const wd = workDir(r);
    const g = gitFor(r);
    // What changed, committed or not, new files included.
    await g(['add', '-N', '.'], wd).catch(() => {});
    const base = (await g(['merge-base', 'HEAD', baseRef(r)], wd)).trim();
    const names = (await g(['diff', '--name-only', base], wd)).split('\n').filter(Boolean);
    const diff = await g(['diff', base], wd);
    const named = planPaths(r.plan);
    const outOfPlan = named.length ? names.filter((f) => !inPlan(f, named)) : [];
    const secrets = findSecrets(diff);
    log(r, 'system', `Reviewing the diff (${names.length} file${names.length === 1 ? '' : 's'}) — round ${round}.`, false);
    save(r);
    const reply = await claudeTurn(r, abort, {
      prompt: SELF_REVIEW_PROMPT(r, base, names, outOfPlan, secrets),
      resume: null,
      step: 'selfReview',
      ephemeral: true,
      role: 'reviewing a change before it goes to people for review. Read only; never change files, commit or push',
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'Agent'],
      canUseTool: fixPermissions(r),
      maxTurns: 60,
    });
    const said = /verdict:\s*(approve|changes)/i.exec(reply)?.[1]?.toLowerCase();
    // A secret in the change is never let through, whatever the reviewer said.
    const verdict: SelfReview['verdict'] = secrets.length || said !== 'approve' ? 'changes' : 'approve';
    const entry: SelfReview = { round, at: new Date().toISOString(), verdict, report: reply.trim(), outOfPlan, secrets };
    r.selfReviews.push(entry);
    if (verdict === 'approve') {
      r.steps.selfReview = 'done';
      log(r, 'system', `Review: approved${outOfPlan.length ? ` (it changed ${outOfPlan.length} file${outOfPlan.length === 1 ? '' : 's'} the plan didn’t name — see the review)` : ''}.`, false);
    } else if (round < max) {
      r.steps.selfReview = 'failed';
      log(r, 'error', `Review: changes asked for (round ${round} of ${max}) — back to the fix.`, false);
    } else {
      r.steps.selfReview = 'waiting';
      log(r, 'error', `Review still asks for changes after ${round} rounds — your call: another round, or go on anyway.`, false);
    }
  } catch (e) {
    r.error = abort.signal.aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    r.steps.selfReview = 'failed';
    log(r, 'error', r.error, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
  const last = r.selfReviews.at(-1);
  if (r.steps.selfReview === 'done') toPullRequest(r);
  else if (r.steps.selfReview === 'failed' && !r.error && last?.verdict === 'changes') {
    r.round = 0;
    void fix(r, undefined, false, undefined, last);
  }
}

/** The review's findings, past its rounds: another round of fixing them. */
export function fixSelfReview(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  const last = r.selfReviews.at(-1);
  if (!last || last.verdict !== 'changes') throw new Error('The review has nothing to fix');
  r.round = 0;
  void fix(r, undefined, false, undefined, last);
  return r;
}

/** The review again, as the code is now. */
export function retrySelfReview(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  void selfReview(r);
  return r;
}

/** The review's findings set aside by the person: on to the pull request. */
export function acceptSelfReview(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for it to finish');
  r.steps.selfReview = 'skipped';
  log(r, 'system', 'Review findings set aside — going on to the pull request.', false);
  save(r);
  toPullRequest(r);
  return r;
}

const SELF_REVIEW_PROMPT = (r: Run, base: string, names: string[], outOfPlan: string[], secrets: string[]) =>
  [
    `Review the change for ${r.ticket.key ? `ticket ${r.ticket.key}` : 'this task'} before it goes to people as a pull request. You did not write it — read it with fresh eyes.`,
    '',
    `# ${r.ticket.key ? `${r.ticket.key}: ` : ''}${r.ticket.title || '(no title)'}`,
    r.ticket.description || '',
    '',
    r.plan ? `## The approved plan\n${r.plan.trim()}` : '',
    '',
    `## The change`,
    `See it with \`git diff ${base}\` (and \`git diff ${base} -- <file>\`). Files changed: ${names.join(', ') || '(none)'}.`,
    outOfPlan.length ? `Files changed that the plan doesn't name — check each belongs in this change: ${outOfPlan.join(', ')}.` : '',
    secrets.length ? `A scan found what look like secrets in added lines — these must not be committed: ${secrets.join('; ')}.` : '',
    '',
    'Check: does it do what the ticket and the plan ask, and nothing else; is it correct (edge cases, errors, nulls); does it break anything that calls it; are tests added or updated where they should be; any debug leftovers, commented-out code, secrets, or unrelated changes.',
    'Do not change any files, commit or push.',
    '',
    'Reply in Markdown. The first line must be exactly "Verdict: APPROVE" or "Verdict: CHANGES". Then the findings, each as "- [high|medium|low] file:line — what and why". Ask for changes only for high or medium findings; low ones are notes.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');

const SELF_FIX_PROMPT = (rv: SelfReview) =>
  [
    `A reviewer looked at your change before the pull request (round ${rv.round}) and asked for changes:`,
    '',
    rv.report,
    rv.secrets.length ? `\nSecrets found in added lines — take them out (use configuration or the environment instead): ${rv.secrets.join('; ')}.` : '',
    '',
    'Deal with the high and medium findings in the code (where one is wrong, say why). Do not commit, push or switch branches.',
    'Reply with a short summary of what you changed.',
  ].join('\n');

// ---- Steps 6–7: the pull request, and its review ----------------------------------

/**
 * Reviewed (or set aside): step 6. It waits for the person's go
 * (Workflow settings: "a person pushes") — the branch goes to the company's
 * GitHub — else it pushes and opens the PR at once. A follow-up (review
 * comments dealt with) pushes to the same PR.
 */
function toPullRequest(r: Run): void {
  if (!r.branch) {
    r.steps.pr = 'skipped';
    r.steps.humanReview = 'skipped';
    log(r, 'system', 'No git branch here (the folder isn’t a git repo) — no pull request.', false);
    save(r);
    return;
  }
  if (getSettings().workflow.pr.confirm) {
    r.steps.pr = 'waiting';
    log(r, 'system', r.pr ? `Ready to push the changes to PR #${r.pr.number} — your go.` : 'Ready to push the branch and open the pull request — your go.', false);
    save(r);
  } else void pushAndOpen(r);
}

/** Step 6 by the person's go. */
export function approvePush(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  if (!r.branch) throw new Error('There is no branch to push');
  void pushAndOpen(r);
  return r;
}

/** Step 6 by hand: the ticket is in Review in Jira. */
export function setMovedToReview(id: string, done: boolean): Run {
  const r = getRun(id);
  r.movedToReview = done;
  save(r);
  return r;
}

/** owner/name on GitHub, and the token to talk to it with. */
async function githubFor(r: Run): Promise<{ slug: string; token: string }> {
  if (r.source === 'repo') {
    const token = githubToken();
    if (!token) throw new Error('Sign in to GitHub first (Connections)');
    return { slug: r.repo, token };
  }
  const origin = r.folder ? await localOrigin(r.folder) : null;
  if (!origin) throw new Error('This folder has no GitHub origin');
  // The app's own GitHub sign-in (Connections); the repo's own credentials only without one.
  const token = githubToken() ?? origin.token;
  if (!token) throw new Error('Sign in to GitHub first (Connections)');
  return { slug: origin.slug, token };
}

function commitMessage(r: Run): string {
  const t = r.ticket;
  const head = `${t.key ? `${t.key}: ` : ''}${t.title || 'Changes by FJ AI Worker'}`.slice(0, 100);
  const body = (r.fixSummary ?? '').replace(/\r/g, '').trim().slice(0, 2000);
  return `${head}\n\n${body}\n\nMade with FJ AI Worker (Claude).`.trim();
}

function prBody(r: Run): string {
  const t = r.ticket;
  const lastTest = r.tests.at(-1);
  return [
    t.url ? `Ticket: ${t.url}` : t.key ? `Ticket: ${t.key}` : '',
    '',
    '## What changed',
    r.fixSummary?.trim() || '(see the commits)',
    '',
    r.plan ? `<details><summary>The approved plan</summary>\n\n${r.plan.trim()}\n\n</details>` : '',
    '',
    '## Tests',
    lastTest ? `${lastTest.passed ? '✅ Passed' : '⚠️ Not passing — accepted by a person'} (round ${lastTest.round}, ${lastTest.by === 'command' ? `\`${r.testCommand}\`` : 'run by Claude'})` : 'Not run.',
    '',
    '---',
    '_Opened by FJ AI Worker. Review before merging — the app never merges._',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

async function pushAndOpen(r: Run): Promise<void> {
  try {
    claim(r);
  } catch {
    return;
  }
  r.steps.pr = 'running';
  save(r);
  try {
    const wt = workDir(r);
    const g = gitFor(r);
    const { slug: repoSlug, token } = await githubFor(r);
    // Commit what's there (the person's identity in their own repo; the
    // GitHub account's, by its noreply address, in the app's clone).
    if ((await g(['status', '--porcelain'], wt)).trim()) {
      await g(['add', '-A'], wt);
      const who: string[] = [];
      if (r.source === 'repo') {
        const me = await githubState().catch(() => null);
        const login = me && me.signedIn ? me.user.login : 'fj-ai-worker';
        who.push('-c', `user.name=${me && me.signedIn ? (me.user.name ?? login) : 'FJ AI Worker'}`, '-c', `user.email=${login}@users.noreply.github.com`);
      }
      await g([...who, 'commit', '-q', '-m', commitMessage(r)], wt);
      log(r, 'system', 'Committed the changes.', false);
    }
    const ahead = (await g(['rev-list', '--count', `${baseRef(r)}..HEAD`], wt)).trim();
    if (ahead === '0') throw new Error('Nothing to push — the branch has no changes over its base');
    log(r, 'system', `Pushing ${r.branch} to ${repoSlug}…`, false);
    save(r);
    if (r.source === 'folder') {
      // Pushed as the app's GitHub sign-in, to the repo's own address: the
      // token goes in a header for this one command (never into the repo's
      // config), and whatever credentials its origin carries aren't used.
      const auth = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
      await gitLocal(['push', `https://github.com/${repoSlug}.git`, `HEAD:refs/heads/${r.branch}`], wt, 900000, [
        ['credential.helper', ''],
        ['http.https://github.com/.extraheader', auth],
      ]);
    } else await g(['push', '-u', 'origin', `HEAD:refs/heads/${r.branch}`], wt, 900000);
    if (!r.pr || r.pr.state !== 'open') {
      const t = r.ticket;
      r.pr = await openPullRequest(token, repoSlug, {
        head: r.branch!,
        base: r.baseBranch!,
        title: `${t.key ? `${t.key}: ` : ''}${t.title || 'Changes by FJ AI Worker'}`.slice(0, 250),
        body: prBody(r),
        draft: getSettings().workflow.pr.draft,
      });
      log(r, 'system', `Opened PR #${r.pr.number}${r.pr.draft ? ' (draft)' : ''}: ${r.pr.url}${t.key ? ` — move ${t.key} to Review in Jira.` : ''}`, false);
    } else log(r, 'system', `Pushed to PR #${r.pr.number}.`, false);
    r.steps.pr = 'done';
    r.steps.humanReview = 'waiting';
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
    r.steps.pr = 'failed';
    log(r, 'error', r.error, false);
  } finally {
    live.delete(r.id);
    save(r);
  }
}

/** Step 7: the PR as it is now, and any new review feedback. */
export async function checkPullRequest(id: string): Promise<Run> {
  const r = getRun(id);
  if (!r.pr) throw new Error('No pull request yet');
  const { slug: repoSlug, token } = await githubFor(r);
  const { pr, feedback } = await readPullRequest(token, repoSlug, r.pr.number);
  const known = new Map(r.feedback.map((f) => [f.id, f]));
  const fresh = feedback.filter((f) => !known.has(f.id));
  r.feedback = feedback.map((f) => ({ ...f, addressed: known.get(f.id)?.addressed ?? false }));
  const was = r.pr.state;
  r.pr = pr;
  if (fresh.length) log(r, 'system', `${fresh.length} new review comment${fresh.length === 1 ? '' : 's'} on PR #${pr.number}.`, false);
  if (pr.state !== was && pr.state !== 'open') {
    r.steps.humanReview = 'done';
    log(r, 'system', pr.state === 'merged' ? `PR #${pr.number} was merged.` : `PR #${pr.number} was closed without merging.`, false);
  }
  save(r);
  return r;
}

/** Step 7: Claude deals with the review comments not yet handed to it, then tests and pushes to the same PR. */
export function fixReview(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  const open = r.feedback.filter((f) => !f.addressed);
  if (!open.length) throw new Error('No review comments to deal with');
  for (const f of open) f.addressed = true;
  r.round = 0;
  // The change moves on: reviewed again before it's pushed.
  r.steps.selfReview = 'pending';
  void fix(r, undefined, false, open);
  return r;
}

/**
 * After the review: the task's branch deleted on GitHub (with the app's
 * sign-in) and here — its worktree and the local branch. Only once its PR is
 * closed or merged: an open PR keeps its branch.
 */
export async function deleteTaskBranch(id: string): Promise<Run> {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Wait for Claude to finish');
  if (!r.branch) throw new Error('This task has no branch');
  if (r.pr?.state === 'open') throw new Error(`PR #${r.pr.number} is still open — close or merge it on GitHub first`);
  if (r.pr) {
    const { slug: repoSlug, token } = await githubFor(r);
    const how = await deleteRemoteBranch(token, repoSlug, r.branch);
    log(r, 'system', how === 'deleted' ? `Deleted ${r.branch} on GitHub (${repoSlug}).` : `${r.branch} was already gone from GitHub.`, false);
  }
  // Here: the worktree first (it has the branch checked out), then the branch.
  const repoDir = r.source === 'folder' ? r.folder : null;
  if (r.linked && repoDir) {
    await gitLocal(['worktree', 'remove', '--force', worktreeDir(r.id)], repoDir).catch(() => fs.rmSync(worktreeDir(r.id), { recursive: true, force: true }));
    await gitLocal(['worktree', 'prune'], repoDir).catch(() => {});
    await gitLocal(['branch', '-D', r.branch], repoDir).catch(() => {});
  } else if (r.source === 'repo') {
    await removeWorktree(r.id, r.repo).catch(() => {});
    await git(['branch', '-D', r.branch], dataPath('repos', r.repo.replace('/', '__'))).catch(() => {});
  }
  r.branchDeleted = true;
  log(r, 'system', `Removed ${r.branch} and its checkout from this computer.`, false);
  save(r);
  return r;
}

/** Step 7 by the person: the review is over (merged or not — on GitHub, by a person). */
export function finishReview(id: string): Run {
  const r = getRun(id);
  r.steps.humanReview = 'done';
  log(r, 'system', 'Review marked done.', false);
  save(r);
  return r;
}

const REVIEW_PROMPT = (r: Run, review: Feedback[]) =>
  [
    `Step 7 — the reviewers of PR #${r.pr?.number} left these comments. Deal with each in the code (or, where one shouldn't change the code, say why).`,
    '',
    ...review.map((f) => `- ${f.author}${f.path ? ` on ${f.path}${f.line ? `:${f.line}` : ''}` : ''}: ${f.body.replace(/\n/g, '\n  ')}`),
    '',
    'Do not commit, push or switch branches — FJ AI Worker tests and pushes to the same PR after.',
    'Reply with a short summary: what you changed for each comment.',
  ].join('\n');

/** While PRs wait for review: look at them every few minutes. */
let watching: ReturnType<typeof setInterval> | null = null;
export function watchPullRequests(): void {
  if (watching) return;
  watching = setInterval(() => {
    for (const r of listRuns()) if (r.pr?.state === 'open' && r.steps.humanReview === 'waiting' && !live.has(r.id)) void checkPullRequest(r.id).catch(() => {});
  }, 3 * 60 * 1000);
}

// ---- What the fix changed ------------------------------------------------------

export type ChangedFile = { path: string; status: string; added: number | null; removed: number | null };

/** Files changed in the run's checkout against the base (committed or not, new files included). */
export async function runChanges(id: string): Promise<ChangedFile[]> {
  const r = getRun(id);
  const wt = workDir(r);
  if (!fs.existsSync(wt) || !r.baseBranch || !(await isGitRepo(wt))) return [];
  const base = (await git(['merge-base', 'HEAD', baseRef(r)], wt)).trim();
  const counts = new Map<string, [number | null, number | null]>();
  for (const line of (await git(['diff', '--numstat', base], wt)).split('\n')) {
    const [a, d, ...p] = line.split('\t');
    if (p.length) counts.set(p.join('\t'), [a === '-' ? null : Number(a), d === '-' ? null : Number(d)]);
  }
  const files: ChangedFile[] = [];
  for (const line of (await git(['status', '--porcelain=v1', '-uall'], wt)).split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim();
    const p = line.slice(3).replace(/^.* -> /, '');
    const c = counts.get(p);
    let added = c?.[0] ?? null;
    if (status === '??') {
      try {
        added = fs.readFileSync(path.join(wt, p), 'utf8').split('\n').length;
      } catch {
        added = null;
      }
    }
    files.push({ path: p, status: status === '??' ? 'A' : status, added, removed: c?.[1] ?? (status === '??' ? 0 : null) });
  }
  return files;
}

/** One file's diff against the base (a new file: all of it). */
export async function runFileDiff(id: string, file: string): Promise<string> {
  const r = getRun(id);
  const wt = workDir(r);
  if (!insideWorktree(r, file)) throw new Error('Not in the checkout');
  const base = (await git(['merge-base', 'HEAD', baseRef(r)], wt)).trim();
  const tracked = (await git(['ls-files', '--', file], wt)).trim();
  if (!tracked) {
    const text = fs.readFileSync(path.join(wt, file), 'utf8');
    return text.split('\n').map((l) => `+${l}`).join('\n');
  }
  return git(['diff', base, '--', file], wt);
}
