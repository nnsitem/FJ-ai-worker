'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AgentTile } from '@/components/AgentTile';
import { Picker } from '@/components/Picker';
import { AgentsIcon, BookIcon, ClaudeIcon, CloseIcon, ConnectionsIcon, EditIcon, FileIcon, FolderIcon, GridIcon, ListIcon, PlusIcon, ProjectIcon, SearchIcon, ToolIcon, TrashIcon } from '@/components/icons';
import { call, type Library, type LibraryAgent, type Settings } from '@/lib/bridge';
import { NEW_TASK_AGENT_KEY } from '@/lib/models';
import { useLibrary } from '@/lib/use-library';
import { ProjectContextView } from './ProjectContextView';

type View = 'agents' | 'skills' | 'projects' | 'source';

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/**
 * Agents & skills, as AI Office's Agent Capabilities (agents/AgentLibrary.tsx):
 * the settings shell — a nav panel of its own (Agents, Skills, Project
 * context, Import & create) beside the content; agents as cards or a list,
 * skills as a list beside each one's files. Everything here is the app's own
 * copy — imported once, edited in place.
 */
export default function AgentsPage() {
  const { library, reload } = useLibrary();
  const [view, setView] = useState<View>('agents');

  const nav: { label: string; views: { id: View; label: string; icon: ReactNode; count?: number }[] }[] = [
    {
      label: 'Library',
      views: [
        { id: 'agents', label: 'Agents', icon: <AgentsIcon size={16} />, count: library?.agents.length },
        { id: 'skills', label: 'Skills', icon: <BookIcon size={16} />, count: library?.skills.length },
      ],
    },
    {
      label: 'Setup',
      views: [
        { id: 'projects', label: 'Project context', icon: <ProjectIcon size={16} /> },
        { id: 'source', label: 'Import & create', icon: <ConnectionsIcon size={16} /> },
      ],
    },
  ];

  const importButton = (
    <button type="button" className="ao-btn-primary ao-library-sync" onClick={() => setView('source')}>
      <PlusIcon size={14} /> Import &amp; create
    </button>
  );

  return (
    <div className="ao-settings-shell">
      <nav className="ao-settings-nav" aria-label="Agent capabilities">
        <h1 className="ao-settings-nav-title">Agent Capabilities</h1>
        {nav.map((g) => (
          <div key={g.label} className="ao-nav-group">
            <p className="ao-nav-group-label">{g.label}</p>
            {g.views.map((v) => (
              <button key={v.id} type="button" className="ao-nav-item" data-active={view === v.id} onClick={() => setView(v.id)}>
                {v.icon}
                {v.label}
                {v.count != null && <span className="ao-nav-count">{v.count}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="ao-settings-content">
        <div className="ao-library-inner">
          {view === 'agents' && <AgentsView library={library} reload={reload} action={importButton} />}
          {view === 'skills' && <SkillsView library={library} reload={reload} action={importButton} />}
          {view === 'projects' && <ProjectContextView />}
          {view === 'source' && <SourceView library={library} reload={reload} />}
        </div>
      </div>
    </div>
  );
}

function ViewHeader({ title, sub, action }: { title: ReactNode; sub: string; action?: ReactNode }) {
  return (
    <header className="ao-library-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action}
    </header>
  );
}

/** Shown in place of a view's content while the library is empty. */
function Empty({ what, action }: { what: string; action: ReactNode }) {
  return (
    <div className="ao-library-banner">
      <AgentsIcon size={16} />
      <span>No {what} yet — import AI Office&apos;s library or a folder, or write one.</span>
      {action}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="ao-search-field ao-library-search">
      <SearchIcon size={14} />
      <input className="ao-search-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button type="button" className="ao-icon-btn" onClick={() => onChange('')} aria-label="Clear search">
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}

/* ---------- Agents ---------- */

function AgentsView({ library, reload, action }: { library: Library | null; reload: () => void; action: ReactNode }) {
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
      <ViewHeader title="Agents" sub="Roles a task can run as — the agent's instructions lead its conversation; the task keeps its folder, model and safety rules" action={action} />
      {library && library.agents.length === 0 ? (
        <Empty what="agents" action={action} />
      ) : (
        <>
          <div className="ao-library-banner">
            <AgentsIcon size={16} />
            <span>Pick an agent per task (its status line, under the message box), or per workflow step in the Workflow page&apos;s Step settings. Every skill is there for any agent to use.</span>
          </div>

          {settings && (
            <div className="ao-library-default">
              <span className="ao-library-default-label">New tasks use</span>
              <Picker<string>
                value={settings.defaultAgent ?? ''}
                onChange={(v) => void setDefault(v)}
                options={[{ value: '', label: 'No agent', hint: 'Plain Claude Code' }, ...(library?.agents ?? []).map((a) => ({ value: a.name, label: a.name }))]}
                icon={AgentsIcon}
                placement="down-start"
                ariaLabel="Default agent for new tasks"
              />
            </div>
          )}

          <div className="ao-library-toolbar">
            <div className="ao-view-toggle" role="tablist" aria-label="Layout">
              <button type="button" className="ao-view-btn" data-active={layout === 'cards'} onClick={() => setLayout('cards')}>
                <GridIcon size={13} />
                Cards
              </button>
              <button type="button" className="ao-view-btn" data-active={layout === 'list'} onClick={() => setLayout('list')}>
                <ListIcon size={13} />
                List
              </button>
            </div>
            <span className="ao-spacer" />
            <SearchBox value={query} onChange={setQuery} placeholder="Filter agents…" />
          </div>

          {agents.length === 0 ? (
            <p className="ao-library-hint">{query.trim() ? `No agents match “${query}”.` : 'Loading…'}</p>
          ) : layout === 'cards' ? (
            <ul className="ao-library-grid">
              {agents.map((a) => (
                <AgentCard key={a.name} agent={a} isDefault={settings?.defaultAgent === a.name} onStart={() => startWith(a.name)} onEdit={() => setEditing(a.name)} />
              ))}
            </ul>
          ) : (
            <ul className="ao-library-rows">
              {agents.map((a) => (
                <li key={a.name} className="ao-library-row">
                  <AgentTile name={a.name} />
                  <span className="ao-library-row-text">
                    <span className="ao-agent-name">
                      {a.name}
                      {settings?.defaultAgent === a.name && (
                        <span className="ao-agent-badge" data-kind="default">
                          default
                        </span>
                      )}
                    </span>
                    <span className="ao-agent-desc">{a.description}</span>
                  </span>
                  <span className="ao-library-row-tools">{a.tools?.length ? a.tools.join(', ') : 'All'}</span>
                  <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => setEditing(a.name)}>
                    <EditIcon size={13} /> Edit
                  </button>
                  <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => startWith(a.name)}>
                    <PlusIcon size={13} /> Start a task
                  </button>
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
    <li className="ao-agent-card">
      <div className="ao-agent-card-top">
        <AgentTile name={agent.name} />
        <div className="ao-agent-card-heading">
          <span className="ao-agent-name">
            {agent.name}
            <span className="ao-agent-badge" data-kind={isDefault ? 'default' : undefined}>
              {isDefault ? 'default' : 'library'}
            </span>
          </span>
          <p className="ao-agent-desc">{agent.description}</p>
        </div>
      </div>

      <dl className="ao-agent-meta">
        <div>
          <ToolIcon size={15} />
          <dt>Tools</dt>
          <dd className="ao-agent-meta-wrap">{agent.tools?.length ? agent.tools.join(', ') : <em>All the step&apos;s tools</em>}</dd>
        </div>
        <div>
          <ClaudeIcon size={15} />
          <dt>Model</dt>
          <dd>{agent.model && agent.model !== 'inherit' ? <code>{agent.model}</code> : <em>Inherited</em>}</dd>
        </div>
      </dl>

      <div className="ao-agent-card-foot">
        <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={onEdit}>
          <EditIcon size={13} /> Edit
        </button>
        <span className="ao-spacer" />
        <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={onStart} title={`A new task with ${agent.name} as its agent`}>
          <PlusIcon size={13} /> Start a task
        </button>
      </div>
    </li>
  );
}

/* ---------- Skills ---------- */

function SkillsView({ library, reload, action }: { library: Library | null; reload: () => void; action: ReactNode }) {
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
            Skills {library && <span className="ao-count ao-library-title-count">{library.skills.length}</span>}
          </>
        }
        sub="Instructions Claude loads when a task needs them — or name one in a message: /skill-name"
        action={action}
      />
      {library && library.skills.length === 0 ? (
        <Empty what="skills" action={action} />
      ) : (
        <div className="ao-skills-panel">
          <SearchBox value={query} onChange={setQuery} placeholder="Filter skills…" />
          <div className="ao-skills-split">
            <ul className="ao-skills-list" aria-label="Skills">
              {skills.map((s) => (
                <li key={s.name}>
                  <button type="button" className="ao-skills-item" data-active={current?.name === s.name} onClick={() => setSelected(s.name)}>
                    <span className="ao-skills-item-text">
                      <span className="ao-skills-item-title">{titleCase(s.name)}</span>
                      <code className="ao-skills-item-slug">{s.name}</code>
                    </span>
                  </button>
                </li>
              ))}
              {skills.length === 0 && <li className="ao-library-hint ao-skills-empty">{query.trim() ? `No skills match “${query}”.` : 'Loading…'}</li>}
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
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let live = true;
    call('librarySkillFiles', name)
      .then((f) => live && setFiles(f))
      .catch(() => live && setFiles([]));
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
    <section className="ao-skill-detail" aria-label={name}>
      <header className="ao-skill-detail-head">
        <div>
          <h3>{titleCase(name)}</h3>
          <code>/{name}</code>
        </div>
        <div className="ao-skill-actions">
          <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => setEditing(true)}>
            <EditIcon size={13} /> Edit SKILL.md
          </button>
          <button type="button" className="ao-icon-btn" onClick={() => void call('libraryReveal', 'skill', name)} aria-label="Show in Finder" title="Show in Finder">
            <FolderIcon size={14} />
          </button>
          <button
            type="button"
            className={`${confirmRemove ? 'ao-btn-danger' : 'ao-btn-secondary'} ao-btn-compact`}
            onBlur={() => setConfirmRemove(false)}
            onClick={() => (confirmRemove ? void call('libraryRemove', 'skill', name).then(onChanged) : setConfirmRemove(true))}
          >
            <TrashIcon size={13} /> {confirmRemove ? 'Remove?' : 'Remove'}
          </button>
        </div>
      </header>
      <div className="ao-skill-detail-about">
        <p>{description}</p>
        {files && (
          <span className="ao-skill-detail-stats">
            {files.length} file{files.length === 1 ? '' : 's'} · {sizeLabel(total)}
          </span>
        )}
      </div>
      <div className="ao-skill-detail-split">
        <ul className="ao-skill-files" aria-label="Files">
          {(files ?? []).map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className="ao-skill-file"
                data-active={f.path === openPath}
                onClick={() => setOpenPath(f.path)}
                title={f.path}
                style={{ paddingLeft: `${0.55 + (f.path.split('/').length - 1) * 0.9}rem` }}
              >
                <FileIcon size={13} />
                <span className="ao-skill-file-name">{f.path.split('/').pop()}</span>
                <span className="ao-skill-file-size">{sizeLabel(f.bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ao-skill-preview" aria-busy={loading}>
          <div className="ao-skill-preview-head">
            <FileIcon size={13} />
            {openPath}
            {preview?.truncated && !loading && <span className="ao-agent-meta-note">truncated</span>}
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

/* ---------- Editor: AI Office's dialog (the Agents Board's confirm), sized for a file ---------- */

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
    <div className="ao-pipe-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !dirty && onClose(false)}>
      <div className="ao-pipe-modal ao-sheet" role="dialog" aria-modal="true" aria-label={`Edit ${name}`}>
        <h3 className="ao-sheet-head">
          <span className="ao-agent-badge">{kind}</span>
          <code>{kind === 'skill' ? `${name}/SKILL.md` : `${name}.md`}</code>
          <span className="ao-spacer" />
          <button type="button" className="ao-icon-btn" onClick={() => void call('libraryReveal', kind, name)} aria-label="Show in Finder" title="Show in Finder">
            <FolderIcon size={14} />
          </button>
        </h3>
        <textarea className="ao-task-input ao-task-textarea ao-sheet-editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} disabled={orig == null} />
        {error && <p className="ao-task-panel-error">{error}</p>}
        <div className="ao-pipe-modal-actions">
          {kind === 'agent' && (
            <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void remove()}>
              <TrashIcon size={13} /> Remove
            </button>
          )}
          <span className="ao-spacer" />
          <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => (!dirty || window.confirm('Discard your changes?')) && onClose(false)}>
            {dirty ? 'Cancel' : 'Close'}
          </button>
          <button type="button" className="ao-btn-primary ao-btn-compact" disabled={!dirty} onClick={() => void save()}>
            Save
          </button>
        </div>
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
      {note && <p className="ao-library-ok">{note}</p>}
      {error && <p className="ao-library-error">{error}</p>}
      <div className="ao-status-card">
        <h3>
          Import
          <span className="ao-badge" data-tone={library?.aiOfficeLibrary ? 'active' : undefined}>
            {library?.aiOfficeLibrary ? 'AI Office found' : 'AI Office not found'}
          </span>
        </h3>
        <p className="ao-status-text">
          Copies <code>.claude/agents</code> and <code>.claude/skills</code> into FJ AI Worker&apos;s own Claude folder. Importing again replaces those of the same name; your other edits stay.
        </p>
        {library?.aiOfficeLibrary ? <code className="ao-library-url">{library.aiOfficeLibrary}</code> : <p className="ao-status-text">AI Office&apos;s library isn&apos;t on this computer — pick a folder instead.</p>}
        <div className="ao-status-actions">
          <button type="button" className="ao-btn-primary" disabled={!library?.aiOfficeLibrary} onClick={() => void doImport('aiOffice')}>
            Import from AI Office
          </button>
          <button type="button" className="ao-btn-secondary" onClick={() => void doImport('pick')}>
            <FolderIcon size={14} /> Import a folder…
          </button>
        </div>
      </div>
      <div className="ao-status-card">
        <h3>Create</h3>
        <div className="ao-view-toggle" role="tablist">
          <button type="button" className="ao-view-btn" data-active={kind === 'agent'} onClick={() => setKind('agent')}>
            <AgentsIcon size={13} /> Agent
          </button>
          <button type="button" className="ao-view-btn" data-active={kind === 'skill'} onClick={() => setKind('skill')}>
            <BookIcon size={13} /> Skill
          </button>
        </div>
        <label className="ao-task-panel-field">
          <span className="ao-task-panel-label">Name</span>
          <input className="ao-task-input ao-mono-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'agent' ? 'bug-fixer' : 'run-e2e-tests'} />
        </label>
        <label className="ao-task-panel-field">
          <span className="ao-task-panel-label">Description</span>
          <textarea className="ao-task-input ao-task-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is for, and when Claude should use it" />
        </label>
        <div className="ao-status-actions">
          <button type="button" className="ao-btn-primary" disabled={!name.trim()} onClick={() => void create()}>
            Create {kind}
          </button>
        </div>
      </div>
    </>
  );
}
