import type { Run, StepId, StepState } from '@/lib/bridge';

export const STEP_LABELS: { id: StepId; label: string; manual?: string }[] = [
  { id: 'analyze', label: 'Analyse the ticket' },
  { id: 'plan', label: 'Plan the fix', manual: 'write it to the ticket' },
  { id: 'review', label: 'Review the plan' },
  { id: 'fix', label: 'Fix', manual: 'move the ticket to In progress' },
  { id: 'test', label: 'Automated tests' },
  { id: 'pr', label: 'Pull request', manual: 'move the ticket to Review' },
  { id: 'humanReview', label: 'Human review' },
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
