'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { call } from '@/lib/bridge';
import { MODELS } from '@/lib/models';
import { useLibrary } from '@/lib/use-library';
import { AgentTile } from './AgentTile';
import { AgentsIcon, ClaudeIcon, CopilotIcon } from './icons';
import { Picker, type PickerOption } from './Picker';

// Picker icons get only a size: on a status line (13) the tile is a small
// chip, in the menu (15) it fills the item's icon slot — AI Office's RolePicker.
const tiles = new Map<string, ComponentType<{ size?: number }>>();
function agentTile(name: string) {
  let Tile = tiles.get(name);
  if (!Tile) {
    const AgentTileIcon = ({ size }: { size?: number }) => <AgentTile name={name} size={size && size <= 13 ? 18 : 32} />;
    Tile = AgentTileIcon;
    tiles.set(name, Tile);
  }
  return Tile;
}

/**
 * A library agent (or none) and a model, as AI Office's Picker — the
 * session's role and agent pickers on its status line.
 */
export function AgentModelPickers({
  agent,
  model,
  onChange,
  disabled,
  inheritLabel,
  placement = 'up',
  engine = 'claude',
}: {
  agent: string | null;
  model: string | null;
  onChange: (next: { agent?: string | null; model?: string | null }) => void;
  disabled?: boolean;
  /** Steps: what "none" means ("The task's agent"); tasks: plain Claude Code. */
  inheritLabel?: { agent: string; model: string };
  placement?: 'up' | 'down' | 'down-start';
  /** Whose models: Claude's, or Copilot's (read from it). */
  engine?: 'claude' | 'copilot';
}) {
  const copilotModels = useCopilotModels(engine === 'copilot');
  const { library } = useLibrary();
  const agents = library?.agents ?? [];
  const missing = agent && library && !agents.some((a) => a.name === agent);
  const agentOptions: PickerOption<string>[] = [
    {
      value: '',
      label: inheritLabel?.agent ?? 'No agent',
      hint: inheritLabel ? 'Whatever the task itself uses' : 'Plain Claude Code',
    },
    ...agents.map((a) => ({ value: a.name, label: a.name, hint: a.description.split(/(?<=\.)\s/)[0], icon: agentTile(a.name) })),
    ...(missing ? [{ value: agent, label: agent, hint: 'Not in the library any more' }] : []),
  ];
  const modelOptions: PickerOption<string>[] =
    engine === 'copilot'
      ? [
          { value: '', label: inheritLabel ? inheritLabel.model : 'Default model', hint: 'Copilot’s own choice' },
          ...(copilotModels ?? []).map((m) => ({ value: m.id, label: m.name })),
          ...(model && copilotModels && !copilotModels.some((m) => m.id === model) ? [{ value: model, label: model }] : []),
        ]
      : MODELS.map((m) => ({
          value: m.value,
          label: m.value === '' && inheritLabel ? inheritLabel.model : m.label,
          hint: m.value === '' ? (inheritLabel ? 'Whatever the task itself uses' : 'Claude Code’s own choice') : undefined,
        }));
  return (
    <>
      <Picker<string> value={agent ?? ''} options={agentOptions} onChange={(v) => onChange({ agent: v || null })} icon={AgentsIcon} placement={placement} ariaLabel="Agent" disabled={disabled} />
      <Picker<string> value={model ?? ''} options={modelOptions} onChange={(v) => onChange({ model: v || null })} icon={engine === 'copilot' ? CopilotIcon : ClaudeIcon} placement={placement} ariaLabel="Model" disabled={disabled} />
    </>
  );
}

let copilotModelsOnce: Promise<{ id: string; name: string }[]> | null = null;

/** Copilot's models (read once, when a Copilot task first shows its pickers). */
function useCopilotModels(on: boolean): { id: string; name: string }[] | null {
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!on) return;
    copilotModelsOnce ??= call('copilotModels').catch(() => {
      copilotModelsOnce = null;
      return [];
    });
    let live = true;
    void copilotModelsOnce.then((m) => live && setModels(m));
    return () => {
      live = false;
    };
  }, [on]);
  return models;
}

/** Which AI does a task's work. */
export function EnginePicker({ engine, onChange, disabled }: { engine: 'claude' | 'copilot'; onChange: (e: 'claude' | 'copilot') => void; disabled?: boolean }) {
  return (
    <Picker<'claude' | 'copilot'>
      value={engine}
      onChange={onChange}
      placement="up"
      ariaLabel="AI"
      disabled={disabled}
      icon={engine === 'copilot' ? CopilotIcon : ClaudeIcon}
      options={[
        { value: 'claude', label: 'Claude', hint: 'Claude Code, the company account' },
        { value: 'copilot', label: 'GitHub Copilot', hint: 'Its own sign-in — Connections › Copilot' },
      ]}
    />
  );
}
