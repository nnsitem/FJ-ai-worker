'use client';

import { MODELS } from '@/lib/models';
import { useLibrary } from '@/lib/use-library';

/** A library agent (or none) and a model, as two compact selects. */
export function AgentModelPickers({
  agent,
  model,
  onChange,
  disabled,
  inheritLabel,
}: {
  agent: string | null;
  model: string | null;
  onChange: (next: { agent?: string | null; model?: string | null }) => void;
  disabled?: boolean;
  /** Steps: what "none" means ("The task's agent"); tasks: plain Claude Code. */
  inheritLabel?: { agent: string; model: string };
}) {
  const { library } = useLibrary();
  const agents = library?.agents ?? [];
  const missing = agent && library && !agents.some((a) => a.name === agent);
  return (
    <>
      <select className="aw-input aw-select aw-compact" value={agent ?? ''} disabled={disabled} onChange={(e) => onChange({ agent: e.target.value || null })} aria-label="Agent" title="Agent">
        <option value="">{inheritLabel?.agent ?? 'Claude Code (no agent)'}</option>
        {agents.map((a) => (
          <option key={a.name} value={a.name} title={a.description}>{a.name}</option>
        ))}
        {missing && <option value={agent}>{agent} (not in the library)</option>}
      </select>
      <select className="aw-input aw-select aw-compact" value={model ?? ''} disabled={disabled} onChange={(e) => onChange({ model: e.target.value || null })} aria-label="Model" title="Model">
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>{m.value === '' && inheritLabel ? inheritLabel.model : m.label}</option>
        ))}
      </select>
    </>
  );
}
