import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dataPath } from './config.js';
import { assertClaudeAccount, claudeEnv, claudeExecutable } from './claude-account.js';
import { createWorktree, removeWorktree, syncRepo } from './repos.js';

/**
 * A run: one ticket worked through the seven steps. Until Jira is allowed,
 * the ticket is typed in by hand (key, title, description) and the steps that
 * would touch Jira — writing the plan to it, moving it — are done by the
 * person, the app showing what to paste and keeping a tick.
 *
 * Steps 1–2 are one Claude session in the run's worktree, with read-only
 * tools: it studies the code and answers with the analysis and the plan.
 * Step 3 is the person's: approve, ask for changes (the same session revises
 * the plan), or skip. Steps 4–7 come in M4–M5.
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
  error: string | null;
  events: RunEvent[];
};

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
      const r = JSON.parse(fs.readFileSync(`${dir()}/${f}`, 'utf8')) as Run;
      // A run the app was closed in the middle of stops there.
      for (const s of STEPS) if (r.steps[s] === 'running') {
        r.steps[s] = 'failed';
        r.error = 'AI Worker was closed while this step ran — run it again';
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

export type NewRun = { ticket: ManualTicket; repo: string; autoApprove: boolean };

export function createRun(input: NewRun): Run {
  loadAll();
  const key = input.ticket.key.trim().toUpperCase();
  const title = input.ticket.title.trim();
  if (!key) throw new Error('Give the ticket’s key (e.g. BF9-123)');
  if (!title && !input.ticket.description.trim()) throw new Error('Give the ticket’s title or description');
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo.trim())) throw new Error('Pick the repo (owner/name)');
  const now = new Date().toISOString();
  const r: Run = {
    id: `${key.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    ticket: { key, title, description: input.ticket.description.trim(), url: input.ticket.url?.trim() || null },
    repo: input.repo.trim(),
    baseBranch: null,
    createdAt: now,
    updatedAt: now,
    steps: Object.fromEntries(STEPS.map((s) => [s, 'pending'])) as Record<StepId, StepState>,
    autoApprove: input.autoApprove,
    plan: null,
    revisions: [],
    planInTicket: false,
    sessionId: null,
    error: null,
    events: [],
  };
  save(r);
  void analyse(r);
  return r;
}

const live = new Map<string, AbortController>();

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
    default:
      return name;
  }
}

async function analyse(r: Run, feedback?: string): Promise<void> {
  const abort = new AbortController();
  live.set(r.id, abort);
  r.error = null;
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
    const stream = query({
      prompt: feedback && resume ? revisePrompt(feedback) : firstPrompt(r),
      options: {
        cwd: dataPath('worktrees', r.id),
        env: claudeEnv(),
        ...(claudeExecutable() ? { pathToClaudeCodeExecutable: claudeExecutable()! } : {}),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'You are AI Worker, analysing a ticket before any code is changed. Only read; never try to edit, write or run commands.',
        },
        // Read-only: these exist, nothing else does.
        tools: ['Read', 'Grep', 'Glob'],
        canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
        settingSources: [],
        maxTurns: 80,
        abortController: abort,
        ...(resume ? { resume } : {}),
      },
    });
    let result: string | null = null;
    for await (const m of stream as AsyncIterable<SDKMessage>) {
      if (m.type === 'assistant') {
        if (m.session_id) r.sessionId = m.session_id;
        for (const b of m.message.content) {
          if (b.type === 'text' && b.text.trim()) log(r, 'text', b.text, false);
          else if (b.type === 'tool_use') log(r, 'tool', describeTool(b.name, (b.input ?? {}) as Record<string, unknown>), false);
        }
        if (r.steps.analyze === 'running' && m.message.content.some((b) => b.type === 'text' && /##\s*Plan/.test(b.text))) r.steps.analyze = 'done';
        save(r);
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && !m.is_error) result = m.result;
        else throw new Error(m.subtype === 'error_max_turns' ? 'Claude ran out of turns before finishing the plan' : 'subtype' in m && m.subtype === 'success' ? m.result : `Claude stopped (${m.subtype})`);
      }
    }
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
}
