import type { Run, StepId, StepState } from '@/lib/bridge';

export const STEP_LABELS: { id: StepId; label: string; short: string; manual?: string }[] = [
  { id: 'analyze', label: 'Analyse the ticket', short: 'Analyse' },
  { id: 'plan', label: 'Plan the fix', short: 'Plan', manual: 'write it to the ticket' },
  { id: 'review', label: 'Review the plan', short: 'Review' },
  { id: 'fix', label: 'Fix', short: 'Fix', manual: 'move the ticket to In progress' },
  { id: 'test', label: 'Automated tests', short: 'Test' },
  { id: 'pr', label: 'Pull request', short: 'PR', manual: 'move the ticket to Review' },
  { id: 'humanReview', label: 'Human review', short: 'Human review' },
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
