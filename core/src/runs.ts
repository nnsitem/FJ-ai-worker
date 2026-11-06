import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './config.js';
import { assertClaudeAccount, claudeEnv, claudeExecutable } from './claude-account.js';
import { baseToolEnv } from './login-env.js';
import { toolEnv } from './network.js';
import { createWorktree, git, removeWorktree, syncRepo, worktreeDir } from './repos.js';
import { getSettings, saveSettings } from './settings.js';

/**
 * A run: one ticket worked through the seven steps. Until Jira is allowed,
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

export type StepId = 'analyze' | 'plan' | 'review' | 'fix' | 'test' | 'pr' | 'humanReview';
export type StepState = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';

export const STEPS: StepId[] = ['analyze', 'plan', 'review', 'fix', 'test', 'pr', 'humanReview'];

export type ManualTicket = { key: string; title: string; description: string; url: string | null };

export type RunEvent = {
  at: string;
  kind: 'text' | 'tool' | 'system' | 'error' | 'you';
  text: string;
};

export type Run = {
  id: string;
  ticket: ManualTicket;
  repo: string;
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
  /** Fix rounds allowed before step 5 waits for the person, and those done. */
  maxRounds: number;
  round: number;
  /** Claude's account of the fix, latest round. */
  fixSummary: string | null;
  tests: TestResult[];
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
};

/** Fields added after a run was saved get their defaults. */
function upgrade(r: Run): Run {
  return {
    ...r,
    branch: r.branch ?? null,
    movedInProgress: r.movedInProgress ?? false,
    testCommand: r.testCommand ?? '',
    maxRounds: r.maxRounds ?? 3,
    round: r.round ?? 0,
    fixSummary: r.fixSummary ?? null,
    tests: r.tests ?? [],
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

export type NewRun = { ticket: ManualTicket; repo: string; autoApprove: boolean; testCommand?: string; maxRounds?: number };

export function createRun(input: NewRun): Run {
  loadAll();
  const key = input.ticket.key.trim().toUpperCase();
  const title = input.ticket.title.trim();
  if (!key) throw new Error('Give the ticket’s key (e.g. BF9-123)');
  if (!title && !input.ticket.description.trim()) throw new Error('Give the ticket’s title or description');
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo.trim())) throw new Error('Pick the repo (owner/name)');
  const repo = input.repo.trim();
  const testCommand = (input.testCommand ?? getSettings().repos[repo]?.testCommand ?? '').trim();
  // Remembered for the repo's next run.
  if (input.testCommand !== undefined) saveSettings({ repos: { [repo]: { testCommand } } });
  const now = new Date().toISOString();
  const r: Run = {
    id: `${key.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    ticket: { key, title, description: input.ticket.description.trim(), url: input.ticket.url?.trim() || null },
    repo,
    baseBranch: null,
    createdAt: now,
    updatedAt: now,
    steps: Object.fromEntries(STEPS.map((s) => [s, 'pending'])) as Record<StepId, StepState>,
    autoApprove: input.autoApprove,
    plan: null,
    revisions: [],
    planInTicket: false,
    sessionId: null,
    branch: null,
    movedInProgress: false,
    testCommand,
    maxRounds: Math.min(10, Math.max(1, Math.round(input.maxRounds ?? 3))),
    round: 0,
    fixSummary: null,
    tests: [],
    error: null,
    events: [],
  };
  save(r);
  void analyse(r);
  return r;
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
  await removeWorktree(id, r.repo);
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
  saveSettings({ repos: { [r.repo]: { testCommand: r.testCommand } } });
  save(r);
  return r;
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
  return r;
}

/** Step 1 again from the start (after a failure, or for a fresh look). */
export function rerunAnalysis(id: string): Run {
  const r = getRun(id);
  if (live.has(id)) throw new Error('Already running');
  r.sessionId = null;
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
  const t = r.ticket;
  return [
    `You are working ticket ${t.key} in the ${r.repo} repository (checked out at the tip of ${r.baseBranch}, in the current folder).`,
    '',
    `# ${t.key}: ${t.title || '(no title)'}`,
    t.url ? `Ticket: ${t.url}` : '',
    '',
    t.description || '(no description)',
    '',
    '---',
    'Step 1 — analyse: read the code that matters to this ticket until you understand it. Do not change any files; your tools are read-only.',
    'Step 2 — plan: write the plan to fix it, for a reviewer to approve before anyone changes code.',
    '',
    PLAN_FORMAT,
  ]
    .filter((l) => l !== null)
    .join('\n');
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
    await assertClaudeAccount();
    if (!r.baseBranch || !feedback) {
      log(r, 'system', `Getting ${r.repo} from GitHub…`);
      r.baseBranch ??= (await syncRepo(r.repo)).defaultBranch;
      const wt = await createWorktree(r.id, r.repo, r.baseBranch);
      log(r, 'system', `Checked out ${r.baseBranch} at ${wt}`);
    }
    const resume = feedback ? r.sessionId : null;
    const result = await claudeTurn(r, abort, {
      prompt: feedback && resume ? revisePrompt(feedback) : firstPrompt(r),
      resume,
      role: 'analysing a ticket before any code is changed. Only read; never try to edit, write or run commands',
      // Read-only: these exist, nothing else does.
      tools: ['Read', 'Grep', 'Glob'],
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
  /** What it's doing, for the system prompt. */
  role: string;
  tools: string[];
  canUseTool?: CanUseTool;
  maxTurns: number;
  onText?: (text: string) => void;
};

/** One prompt to Claude in the run's worktree, logged as it goes; resolves with its final reply. */
async function claudeTurn(r: Run, abort: AbortController, t: Turn): Promise<string> {
  const stream = query({
    prompt: t.prompt,
    options: {
      cwd: worktreeDir(r.id),
      env: claudeEnv(),
      ...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable()! } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `You are FJ AI Worker, ${t.role}.` },
      tools: t.tools,
      canUseTool: t.canUseTool ?? (async (_tool, input) => ({ behavior: 'allow', updatedInput: input })),
      settingSources: [],
      maxTurns: t.maxTurns,
      abortController: abort,
      ...(t.resume ? { resume: t.resume } : {}),
    },
  });
  let result: string | null = null;
  for await (const m of stream as AsyncIterable<SDKMessage>) {
    if (m.type === 'assistant') {
      if (m.session_id) r.sessionId = m.session_id;
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) {
          log(r, 'text', b.text, false);
          t.onText?.(b.text);
        } else if (b.type === 'tool_use') log(r, 'tool', describeTool(b.name, (b.input ?? {}) as Record<string, unknown>), false);
      }
      save(r);
    } else if (m.type === 'result') {
      if (m.subtype === 'success' && !m.is_error) result = m.result;
      else if (m.subtype === 'error_max_turns') throw new Error('Claude ran out of turns before finishing');
      else throw new Error(m.subtype === 'success' ? m.result : `Claude stopped (${m.subtype})`);
    }
  }
  if (result == null) throw new Error('Claude gave no answer');
  return result;
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
  const root = fs.realpathSync(worktreeDir(r.id));
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
    `Step 4 — fix: the plan is approved. Make the change now, in this checkout (branch ${r.branch}).`,
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

async function fix(r: Run, failed?: TestResult, byHand = false): Promise<void> {
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
    await assertClaudeAccount();
    const wt = worktreeDir(r.id);
    if (!fs.existsSync(wt)) {
      r.baseBranch ??= (await syncRepo(r.repo)).defaultBranch;
      await createWorktree(r.id, r.repo, r.baseBranch);
    }
    if (!r.branch) {
      const name = `fix/${r.ticket.key}-${slug(r.ticket.title || r.ticket.description) || 'change'}`;
      const exists = (await git(['branch', '--list', name], wt)).trim();
      await git(exists ? ['switch', name] : ['switch', '-c', name], wt);
      r.branch = name;
      log(r, 'system', `On branch ${name}. Move ${r.ticket.key} to In progress in Jira.`, false);
    }
    if (failed) log(r, 'system', `Round ${r.round + 1}: fixing what the tests found.`, false);
    else if (byHand) log(r, 'system', `Round ${r.round + 1}: another go at the fix.`, false);
    r.fixSummary = await claudeTurn(r, abort, {
      prompt: failed ? RETRY_PROMPT(r, failed) : FIX_PROMPT(r),
      resume: r.sessionId,
      role: `fixing ticket ${r.ticket.key} in this checkout. Change files only inside it; never commit, push or switch branches`,
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'TodoWrite'],
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
  if (r.steps.fix === 'done') void runTests(r);
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

const TEST_PROMPT = [
  'Step 5 — test: run the repository’s tests that cover your change (and the related suites), the way this project runs them.',
  'Do not change any files now. If the tests can’t run here (missing services, credentials), say exactly what is missing.',
  '',
  'Your reply must start with a line that is exactly "Verdict: PASS" or "Verdict: FAIL", then what you ran and what happened (the failures in full).',
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
    if (r.testCommand) {
      log(r, 'system', `Running ${r.testCommand}`, false);
      save(r);
      const out = await runCommand(r.testCommand, worktreeDir(r.id), abort.signal);
      if (abort.signal.aborted) throw new Error('Stopped');
      result = { round, at: new Date().toISOString(), passed: out.ok, by: 'command', output: out.output };
    } else {
      const reply = await claudeTurn(r, abort, {
        prompt: TEST_PROMPT,
        resume: r.sessionId,
        role: `testing the fix for ${r.ticket.key}. Run tests and read; do not change files, commit or push`,
        tools: ['Read', 'Grep', 'Glob', 'Bash'],
        canUseTool: fixPermissions(r),
        maxTurns: 60,
      });
      const verdict = /verdict:\s*(pass|fail)/i.exec(reply)?.[1]?.toLowerCase();
      result = { round, at: new Date().toISOString(), passed: verdict === 'pass', by: 'claude', output: reply.trim() };
    }
    r.round = round;
    r.tests.push(result);
    if (result.passed) {
      r.steps.test = 'done';
      log(r, 'system', `Tests passed (round ${round}).`, false);
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
}

// ---- What the fix changed ------------------------------------------------------

export type ChangedFile = { path: string; status: string; added: number | null; removed: number | null };

/** Files changed in the run's checkout against the base (committed or not, new files included). */
export async function runChanges(id: string): Promise<ChangedFile[]> {
  const r = getRun(id);
  const wt = worktreeDir(r.id);
  if (!fs.existsSync(wt) || !r.baseBranch) return [];
  const base = (await git(['merge-base', 'HEAD', `origin/${r.baseBranch}`], wt)).trim();
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
  const wt = worktreeDir(r.id);
  if (!insideWorktree(r, file)) throw new Error('Not in the checkout');
  const base = (await git(['merge-base', 'HEAD', `origin/${r.baseBranch}`], wt)).trim();
  const tracked = (await git(['ls-files', '--', file], wt)).trim();
  if (!tracked) {
    const text = fs.readFileSync(path.join(wt, file), 'utf8');
    return text.split('\n').map((l) => `+${l}`).join('\n');
  }
  return git(['diff', base, '--', file], wt);
}
