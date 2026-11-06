/** The models a task or a step can run on ('' = Claude Code's default). */
export const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Default model' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export const modelLabel = (m: string | null) => MODELS.find((x) => x.value === (m ?? ''))?.label ?? m ?? 'Default model';

/** Which task the Tasks page opens on (the Workflow board's cards set it). */
export const OPEN_TASK_KEY = 'aw.openTask';

/** An agent a new task should start with (an agent card's "Start a task"). */
export const NEW_TASK_AGENT_KEY = 'aw.newTaskAgent';
