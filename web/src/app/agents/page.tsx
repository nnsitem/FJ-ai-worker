'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AddIcon, AgentsIcon, ConnectionsIcon, ProjectIcon, SkillsIcon } from '@/components/icons';
import { ProjectContextView } from './ProjectContextView';
import { call, type Library, type LibraryAgent, type Settings } from '@/lib/bridge';
import { NEW_TASK_AGENT_KEY } from '@/lib/models';
import { useLibrary } from '@/lib/use-library';

type View = 'agents' | 'skills' | 'projects' | 'source';

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Agents & skills, laid out as AI Office's Agent Capabilities: a menu of its
 * own (Agents, Skills, Import), agents as cards, skills as a list with each
 * one's files. Everything here is the app's own copy — imported once, edited
 * in place.
 */
export default function AgentsPage() {
  const { library, reload } = useLibrary();
  const [view, setView] = useState<View>('agents');

  const nav: { group: string; items: { id: View; label: string; icon: ReactNode; count?: number }[] }[] = [
    {
      group: 'Library',
      items: [
        { id: 'agents', label: 'Agents', icon: <AgentsIcon size={16} />, count: library?.agents.length },
        { id: 'skills', label: 'Skills', icon: <SkillsIcon size={16} />, count: library?.skills.length },
      ],
    },
    {
      group: 'Setup',
      items: [
        { id: 'projects', label: 'Project context', icon: <ProjectIcon size={16} /> },
        { id: 'source', label: 'Import & create', icon: <ConnectionsIcon size={16} /> },
      ],
    },
  ];

  return (
    <div className="aw-caps">
      <nav className="aw-caps-nav" aria-label="Agent capabilities">
        <h1 className="aw-caps-title">Agent Capabilities</h1>
        {nav.map((g) => (
          <div key={g.group} className="aw-nav-group">
            <div className="aw-nav-label">{g.group}</div>
            {g.items.map((i) => (
              <button key={i.id} type="button" className="aw-nav-item" aria-current={view === i.id ? 'page' : undefined} onClick={() => setView(i.id)}>
                {i.icon}
                {i.label}
                {i.count != null && <span className="aw-count aw-nav-count">{i.count}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="aw-caps-content">
        <div className="aw-caps-inner">
          {view === 'agents' && <AgentsView library={library} reload={reload} onImport={() => setView('source')} />}
          {view === 'skills' && <SkillsView library={library} reload={reload} onImport={() => setView('source')} />}
          {view === 'projects' && <ProjectContextView />}
          {view === 'source' && <SourceView library={library} reload={reload} />}
        </div>
      </section>
    </div>
  );
}

function ViewHeader({ title, sub, action }: { title: ReactNode; sub: string; action?: ReactNode }) {
  return (
    <header className="aw-caps-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action}
    </header>
  );
}

function Empty({ what, onImport }: { what: string; onImport: () => void }) {
  return (
    <div className="aw-caps-banner">
      <AgentsIcon size={16} />
      <span>No {what} yet — import AI Office&apos;s library or a folder, or write one.</span>
      <button type="button" className="aw-btn aw-compact" data-primary onClick={onImport}>Import & create</button>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="aw-input aw-compact aw-caps-search" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

/** An agent's tile: its initials on the brand gradient, the hue turned by its name. */
function AgentTile({ name }: { name: string }) {
  const letters = name.split(/[-_\s]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="aw-agent-tile" style={{ filter: `hue-rotate(${(h % 70) - 35}deg)` }} aria-hidden="true">
      {letters}
    </span>
  );
}

/* ---------- Agents ---------- */

function AgentsView({ library, reload, onImport }: { library: Library | null; reload: () => void; onImport: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    call('getSettings').then(setSettings).catch(() => {});
  }, []);

  const agents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = library?.agents ?? [];
    return q ? all.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(q)) : all;
  }, [library, query]);

  const startWith = (name: string) => {
    try {
      sessionStorage.setItem(NEW_TASK_AGENT_KEY, name);
    } catch {
      // the new task then starts with the default
    }
    router.push('/tasks');
  };

  const setDefault = async (name: string) => setSettings(await call('saveSettings', { defaultAgent: name || null }));

  return (
    <>
      <ViewHeader
        title="Agents"
        sub="Roles a task can run as — the agent's instructions lead its conversation; the task keeps its folder, model and safety rules"
        action={
          <button type="button" className="aw-btn" onClick={onImport}>
            <AddIcon size={15} /> Import & create
          </button>
        }
      />
      {library && library.agents.length === 0 ? (
        <Empty what="agents" onImport={onImport} />
      ) : (
        <>
          <div className="aw-caps-banner">
            <AgentsIcon size={16} />
            <span>
              Pick an agent per task (the task&apos;s header), or per workflow step on the Workflow page. Every skill is there for any agent to use.
            </span>
          </div>
          {settings && (
            <div className="aw-caps-default">
              <span>New tasks use</span>
              <select className="aw-input aw-select aw-compact" value={settings.defaultAgent ?? ''} onChange={(e) => void setDefault(e.target.value)} aria-label="Default agent for new tasks">
                <option value="">No agent — Claude Code</option>
                {(library?.agents ?? []).map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="aw-caps-toolbar">
            <div className="aw-segmented" role="tablist" aria-label="Layout">
              <button type="button" role="tab" aria-selected={layout === 'cards'} onClick={() => setLayout('cards')}>Cards</button>
              <button type="button" role="tab" aria-selected={layout === 'list'} onClick={() => setLayout('list')}>List</button>
            </div>
            <span style={{ flex: 1 }} />
            <SearchBox value={query} onChange={setQuery} placeholder="Filter agents…" />
          </div>
          {agents.length === 0 ? (
            <p className="aw-muted">{query.trim() ? `No agents match “${query}”.` : 'Loading…'}</p>
          ) : layout === 'cards' ? (
            <ul className="aw-agent-grid">
              {agents.map((a) => (
                <AgentCard key={a.name} agent={a} isDefault={settings?.defaultAgent === a.name} onStart={() => startWith(a.name)} onEdit={() => setEditing(a.name)} />
              ))}
            </ul>
          ) : (
            <ul className="aw-agent-rows">
              {agents.map((a) => (
                <li key={a.name} className="aw-agent-row">
                  <AgentTile name={a.name} />
                  <span className="aw-agent-row-text">
                    <span className="aw-agent-name">
                      {a.name}
                      {settings?.defaultAgent === a.name && <span className="aw-agent-badge" data-kind="default">default</span>}
                    </span>
                    <span className="aw-agent-desc">{a.description}</span>
                  </span>
                  <button type="button" className="aw-btn aw-compact" onClick={() => setEditing(a.name)}>Edit</button>
                  <button type="button" className="aw-btn aw-compact" onClick={() => startWith(a.name)}>Start a task</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editing && (
        <Editor
          kind="agent"
          name={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) reload();
          }}
        />
      )}
    </>
  );
}

function AgentCard({ agent, isDefault, onStart, onEdit }: { agent: LibraryAgent; isDefault: boolean; onStart: () => void; onEdit: () => void }) {
  return (
    <li className="aw-agent-card">
      <div className="aw-agent-card-top">
        <AgentTile name={agent.name} />
        <div className="aw-agent-card-heading">
          <span className="aw-agent-name">
            {agent.name}
            <span className="aw-agent-badge" data-kind={isDefault ? 'default' : undefined}>{isDefault ? 'default' : 'library'}</span>
          </span>
          <p className="aw-agent-desc">{agent.description}</p>
        </div>
      </div>
      <dl className="aw-agent-meta">
        <div>
          <dt>Tools</dt>
          <dd>{agent.tools?.length ? agent.tools.join(', ') : <em>All the step&apos;s tools</em>}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{agent.model && agent.model !== 'inherit' ? <code>{agent.model}</code> : <em>Inherited</em>}</dd>
        </div>
      </dl>
      <div className="aw-agent-card-foot">
        <button type="button" className="aw-btn aw-compact" onClick={onEdit}>Edit</button>
        <button type="button" className="aw-btn aw-compact" onClick={onStart}>
          <AddIcon size={13} /> Start a task
        </button>
      </div>
    </li>
  );
}

/* ---------- Skills ---------- */

function SkillsView({ library, reload, onImport }: { library: Library | null; reload: () => void; onImport: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const skills = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = library?.skills ?? [];
    return q ? all.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)) : all;
  }, [library, query]);
  // Never an empty detail while there's a skill to show (and it follows the filter).
  const current = skills.find((s) => s.name === selected) ?? skills[0] ?? null;

  return (
    <>
      <ViewHeader
        title={
          <>
            Skills {library && <span className="aw-count">{library.skills.length}</span>}
          </>
        }
        sub="Instructions Claude loads when a task needs them — or name one in a message: /skill-name"
      />
      {library && library.skills.length === 0 ? (
        <Empty what="skills" onImport={onImport} />
      ) : (
        <div className="aw-skills-panel">
          <SearchBox value={query} onChange={setQuery} placeholder="Filter skills…" />
          <div className="aw-skills-split">
            <ul className="aw-skills-list" aria-label="Skills">
              {skills.map((s) => (
                <li key={s.name}>
                  <button type="button" className="aw-skills-item" aria-current={current?.name === s.name || undefined} onClick={() => setSelected(s.name)}>
                    <span className="aw-skills-item-title">{titleCase(s.name)}</span>
                    <code className="aw-skills-item-slug">{s.name}</code>
                  </button>
                </li>
              ))}
              {skills.length === 0 && <li className="aw-muted aw-pad">{query.trim() ? `No skills match “${query}”.` : 'Loading…'}</li>}
            </ul>
            {current && <SkillDetail key={current.name} name={current.name} description={current.description} onChanged={reload} />}
          </div>
        </div>
      )}
    </>
  );
}

function SkillDetail({ name, description, onChanged }: { name: string; description: string; onChanged: () => void }) {
  const [files, setFiles] = useState<{ path: string; bytes: number }[] | null>(null);
  const [openPath, setOpenPath] = useState('SKILL.md');
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    call('librarySkillFiles', name).then((f) => live && setFiles(f)).catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [name]);

  useEffect(() => {
    let live = true;
    call('librarySkillFile', name, openPath)
      .then((r) => live && setPreview({ path: openPath, text: r.text, truncated: r.truncated }))
      .catch(() => live && setPreview({ path: openPath, text: '(could not read this file)', truncated: false }));
    return () => {
      live = false;
    };
  }, [name, openPath, editing]);

  const total = files?.reduce((n, f) => n + f.bytes, 0) ?? 0;
  const loading = preview?.path !== openPath;

  return (
    <section className="aw-skill-detail" aria-label={name}>
      <header className="aw-skill-detail-head">
        <div>
          <h3>{titleCase(name)}</h3>
          <code>/{name}</code>
        </div>
        <div className="aw-row">
          <button type="button" className="aw-btn aw-compact" onClick={() => setEditing(true)}>Edit SKILL.md</button>
          <button type="button" className="aw-btn aw-compact" onClick={() => void call('libraryReveal', 'skill', name)}>Show in Finder</button>
          <button
            type="button"
            className="aw-btn aw-compact"
            data-danger
            onClick={() => window.confirm(`Remove the skill ${name}?`) && void call('libraryRemove', 'skill', name).then(onChanged)}
          >
            Remove
          </button>
        </div>
      </header>
      <div className="aw-skill-detail-about">
        <p>{description}</p>
        {files && (
          <span className="aw-muted aw-small">
            {files.length} file{files.length === 1 ? '' : 's'} · {sizeLabel(total)}
          </span>
        )}
      </div>
      <div className="aw-skill-detail-split">
        <ul className="aw-skill-files" aria-label="Files">
          {(files ?? []).map((f) => (
            <li key={f.path}>
              <button type="button" className="aw-skill-file" aria-current={f.path === openPath || undefined} onClick={() => setOpenPath(f.path)} title={f.path} style={{ paddingLeft: `${0.55 + (f.path.split('/').length - 1) * 0.9}rem` }}>
                <span className="aw-skill-file-name">{f.path.split('/').pop()}</span>
                <span className="aw-skill-file-size">{sizeLabel(f.bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="aw-skill-preview" aria-busy={loading}>
          <div className="aw-skill-preview-head">
            {openPath}
            {preview?.truncated && !loading && <span className="aw-muted"> · truncated</span>}
          </div>
          <pre>{loading ? '' : preview?.text}</pre>
        </div>
      </div>
      {editing && (
        <Editor
          kind="skill"
          name={name}
          onClose={(changed) => {
            setEditing(false);
            if (changed) onChanged();
          }}
        />
      )}
    </section>
  );
}

/* ---------- Editor (a sheet over the page) ---------- */

function Editor({ kind, name, onClose }: { kind: 'agent' | 'skill'; name: string; onClose: (changed: boolean) => void }) {
  const [orig, setOrig] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('libraryItem', kind, name)
      .then((i) => {
        setOrig(i.text);
        setText(i.text);
      })
      .catch((e) => setError((e as Error).message));
  }, [kind, name]);

  const save = async () => {
    try {
      await call('librarySave', kind, name, text);
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the ${kind} ${name}?`)) return;
    await call('libraryRemove', kind, name);
    onClose(true);
  };
  const dirty = orig != null && text !== orig;

  return (
    <div className="aw-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose(false)}>
      <div className="aw-sheet" role="dialog" aria-label={`Edit ${name}`}>
        <header className="aw-sheet-head">
          <span className="aw-agent-badge">{kind}</span>
          <h3 className="aw-mono">{kind === 'skill' ? `${name}/SKILL.md` : `${name}.md`}</h3>
          <span style={{ flex: 1 }} />
          <button type="button" className="aw-btn aw-compact" onClick={() => void call('libraryReveal', kind, name)}>Show in Finder</button>
          {kind === 'agent' && <button type="button" className="aw-btn aw-compact" data-danger onClick={() => void remove()}>Remove</button>}
        </header>
        <textarea className="aw-textarea aw-sheet-editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} disabled={orig == null} />
        <footer className="aw-row">
          <button type="button" className="aw-btn" data-primary disabled={!dirty} onClick={() => void save()}>Save</button>
          <button type="button" className="aw-btn" onClick={() => (!dirty || window.confirm('Discard your changes?')) && onClose(false)}>{dirty ? 'Cancel' : 'Close'}</button>
          {error && <span className="aw-error">{error}</span>}
        </footer>
      </div>
    </div>
  );
}

/* ---------- Import & create ---------- */

function SourceView({ library, reload }: { library: Library | null; reload: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'agent' | 'skill'>('agent');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const doImport = async (from: 'aiOffice' | 'pick') => {
    setError(null);
    setNote(null);
    try {
      const r = await call('libraryImport', from);
      if (r) {
        setNote(`Imported ${r.agents} agent${r.agents === 1 ? '' : 's'} and ${r.skills} skill${r.skills === 1 ? '' : 's'}.`);
        reload();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const create = async () => {
    setError(null);
    setNote(null);
    try {
      await call('libraryCreate', kind, name.trim(), description);
      setNote(`Created the ${kind} ${name.trim()} — open it from ${kind === 'agent' ? 'Agents' : 'Skills'} to write it.`);
      setName('');
      setDescription('');
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <ViewHeader title="Import & create" sub="Where the library comes from — a one-off copy, so nothing here depends on AI Office or its repo" />
      {note && <p className="aw-ok">{note}</p>}
      {error && <p className="aw-error">{error}</p>}
      <section className="aw-card">
        <div className="aw-card-head"><h2>Import</h2></div>
        <p className="aw-muted">
          Copies <code>.claude/agents</code> and <code>.claude/skills</code> into FJ AI Worker&apos;s own Claude folder. Importing again replaces those of the same name; your other edits stay.
        </p>
        <div className="aw-row">
          <button type="button" className="aw-btn" data-primary disabled={!library?.aiOfficeLibrary} onClick={() => void doImport('aiOffice')}>
            Import from AI Office
          </button>
          <button type="button" className="aw-btn" onClick={() => void doImport('pick')}>Import a folder…</button>
        </div>
        <span className="aw-muted aw-small">{library?.aiOfficeLibrary ? `AI Office’s library: ${library.aiOfficeLibrary}` : 'AI Office’s library isn’t on this computer — pick a folder instead.'}</span>
      </section>
      <section className="aw-card">
        <div className="aw-card-head"><h2>Create</h2></div>
        <div className="aw-segmented" role="tablist">
          <button type="button" role="tab" aria-selected={kind === 'agent'} onClick={() => setKind('agent')}>Agent</button>
          <button type="button" role="tab" aria-selected={kind === 'skill'} onClick={() => setKind('skill')}>Skill</button>
        </div>
        <label className="aw-field">
          <span>Name</span>
          <input className="aw-input aw-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'agent' ? 'bug-fixer' : 'run-e2e-tests'} />
        </label>
        <label className="aw-field">
          <span>Description</span>
          <textarea className="aw-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is for, and when Claude should use it" />
        </label>
        <div className="aw-row">
          <button type="button" className="aw-btn" data-primary disabled={!name.trim()} onClick={() => void create()}>Create {kind}</button>
        </div>
      </section>
    </>
  );
}
