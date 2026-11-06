import type { Run, StepId, StepState } from '@/lib/bridge';

/** The steps in order, each with the number it goes by (5½ sits between the tests and the PR). */
export const STEP_LABELS: { id: StepId; n: string; label: string; short: string; manual?: string }[] = [
  { id: 'analyze', n: '1', label: 'Analyse the ticket', short: 'Analyse' },
  { id: 'plan', n: '2', label: 'Plan the fix', short: 'Plan', manual: 'write it to the ticket' },
  { id: 'review', n: '3', label: 'Review the plan', short: 'Review' },
  { id: 'fix', n: '4', label: 'Fix', short: 'Fix', manual: 'move the ticket to In progress' },
  { id: 'test', n: '5', label: 'Automated tests', short: 'Test' },
  { id: 'selfReview', n: '5½', label: 'AI review of the diff', short: 'AI review' },
  { id: 'pr', n: '6', label: 'Pull request', short: 'PR', manual: 'move the ticket to Review' },
  { id: 'humanReview', n: '7', label: 'Human review', short: 'Human review' },
];

/** The step the run is on: the first not done or skipped. */
export function currentStep(r: Run): { index: number; id: StepId; state: StepState } | null {
  const i = STEP_LABELS.findIndex((s) => r.steps[s.id] !== 'done' && r.steps[s.id] !== 'skipped');
  return i < 0 ? null : { index: i, id: STEP_LABELS[i].id, state: r.steps[STEP_LABELS[i].id] };
}

export const STATE_TONE: Record<StepState, string | undefined> = {
  pending: undefined,
  running: 'info',
  waiting: 'warn',
  done: 'ok',
  skipped: undefined,
  failed: 'bad',
};

export type Standing = 'working' | 'you' | 'done' | 'idle';

/** Where a task stands, for the Tasks tabs and its card. */
export function standing(r: Run): Standing {
  if (r.running) return 'working';
  const cur = currentStep(r);
  if (r.workflowStarted && !cur) return 'done';
  if (r.error || cur?.state === 'waiting') return 'you';
  return 'idle';
}

/** Where a task works, short: the repo's name, the folder's, or none yet. */
export const placeName = (r: Run) =>
  r.source === 'repo' ? r.repo.split('/')[1] || r.repo : r.source === 'folder' ? ((r.folder ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '') : 'no folder';
