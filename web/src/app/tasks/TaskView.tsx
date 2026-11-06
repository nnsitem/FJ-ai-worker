'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AgentLogo } from '@/components/AgentLogo';
import { AgentModelPickers } from '@/components/AgentModelPickers';
import { RunAgentButton, TaskAgents } from '@/components/AgentActivity';
import { LinkOpener } from '@/components/LinkOpener';
import { BranchIcon, CloseIcon, FileIcon, FolderIcon, JiraIcon, PanelIcon, PipelineIcon, PlayIcon, TrashIcon } from '@/components/icons';
import { call, type ManualTicket, type RepoSummary, type Run } from '@/lib/bridge';
import { OPEN_TASK_KEY } from '@/lib/models';
import { ChangesList } from './Changes';
import { Transcript, Composer } from './Conversation';
import { currentStep, STEP_LABELS } from './steps';

const SSO = /https:\/\/github\.com\/\S+\/sso\S*/;
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * One task, as AI Office's session detail: its head (title, the ticket, the
 * workflow, the Changes toggle), the conversation, the composer and — under
 * it — the status bar where its agent, model and folder are picked; the
 * Changes panel slides in beside it.
 */
export function TaskView({
  run,
  listHidden,
  onShowList,
  changesOpen,
  onToggleChanges,
  onClose,
  onDelete,
}: {
  run: Run;
  listHidden: boolean;
  onShowList: () => void;
  changesOpen: boolean;
  onToggleChanges: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [ticketOpen, setTicketOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const t = run.ticket;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toWorkflow = () => {
    try {
      sessionStorage.setItem(OPEN_TASK_KEY, run.id);
    } catch {
      // the board opens without a card picked
    }
    router.push('/workflow');
  };

  const cur = currentStep(run);
  const started = run.sessionId != null;

  return (
    <>
      <header className="ao-panel-head ao-detail-head">
        {/* Only while the list is hidden — otherwise its own header carries the toggle. */}
        {listHidden && (
          <button type="button" className="ao-icon-btn ao-panel-toggle" data-collapsed onClick={onShowList} aria-label="Show tasks" title="Show tasks">
            <PanelIcon size={15} />
          </button>
        )}
        <div className="ao-detail-heading">
          {renaming ? (
            <input
              className="ao-card-title-input ao-detail-rename"
              defaultValue={t.title}
              autoFocus
              onFocus={(e) => e.target.select()}
              onBlur={(e) => (setRenaming(false), void act(() => call('runsSetTicket', run.id, { title: e.target.value })))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <h2 className="ao-detail-title" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {t.title || 'New task'}
            </h2>
          )}
        </div>
        <button type="button" className="ao-btn-secondary ao-btn-compact" data-active={ticketOpen || undefined} onClick={() => setTicketOpen((v) => !v)} aria-expanded={ticketOpen} title="The ticket this task works from">
          <JiraIcon size={13} />
          {t.key || 'Ticket'}
        </button>
        {run.workflowStarted ? (
          <button type="button" className="ao-btn-secondary ao-btn-compact ao-wf-chip ao-step-chip" data-step={cur ? STEP_LABELS[cur.index].id : 'finished'} onClick={toWorkflow} title="Open on the Workflow page">
            <PipelineIcon size={13} />
            {cur ? `${STEP_LABELS[cur.index].n}. ${STEP_LABELS[cur.index].short}` : 'Finished'}
          </button>
        ) : (
          <button
            type="button"
            className="ao-btn-secondary ao-btn-compact"
            disabled={run.running}
            onClick={() => void act(async () => (await call('runsStartWorkflow', run.id), toWorkflow()))}
            title="Carry it through the seven steps"
          >
            <PlayIcon size={13} /> Run workflow
          </button>
        )}
        <TaskAgents run={run} />
        <button
          type="button"
          className="ao-icon-btn ao-changes-toggle"
          data-active={changesOpen}
          onClick={onToggleChanges}
          aria-label={changesOpen ? 'Close file changes' : 'Open file changes'}
          aria-expanded={changesOpen}
          title={changesOpen ? 'Close file changes' : 'Open file changes'}
        >
          <PanelIcon size={15} />
          {changeCount > 0 && <span className="ao-changes-count">{changeCount}</span>}
        </button>
        <button type="button" className="ao-icon-btn" onClick={onDelete} aria-label="Delete the task" title="Delete the task">
          <TrashIcon size={15} />
        </button>
        {!listHidden && (
          <button type="button" className="ao-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <CloseIcon size={15} />
          </button>
        )}
      </header>

      {ticketOpen && <TicketForm ticket={t} onSave={(p) => void act(async () => (await call('runsSetTicket', run.id, p), setTicketOpen(false)))} onCancel={() => setTicketOpen(false)} />}

      {(run.error || error) && (
        <div className="ao-detail-errors">
          {run.error && <p className="ao-task-panel-error">{run.error.replace(/:\s*https:\/\/\S+$/, '')}</p>}
          {run.error && SSO.test(run.error) && <LinkOpener url={SSO.exec(run.error)![0]} />}
          {error && <p className="ao-task-panel-error">{error}</p>}
        </div>
      )}

      <div className="ao-detail-body">
        <div className="ao-chat-pane">
          <Transcript run={run} />
          <Composer run={run} />
          <div className="ao-statusbar">
            <span className="ao-agent-mark" title="Claude — the company account" aria-label="Claude">
              <AgentLogo provider="claude" />
            </span>
            <span className="ao-dot-sep">·</span>
            <AgentModelPickers agent={run.agent} model={run.model} disabled={run.running} onChange={(o) => void act(() => call('runsSetOptions', run.id, o))} />
            <span className="ao-dot-sep">·</span>
            <PlacePicker run={run} locked={started || run.running} onError={setError} />
            {run.branch && (
              <>
                <span className="ao-dot-sep">·</span>
                <span className="ao-status-repo ao-status-branch" title={run.branch}>
                  <BranchIcon size={12} />
                  {run.branch}
                </span>
              </>
            )}
            <span className="ao-dot-sep">·</span>
            <RunAgentButton run={run} disabled={run.running || run.source === 'none'} />
            <div className="ao-spacer" />
            <span className="ao-mono-dim">{run.id.slice(0, 8)}</span>
          </div>
        </div>

        <aside className="ao-changes-panel" aria-label="File changes" aria-hidden={!changesOpen} inert={!changesOpen}>
          <header className="ao-changes-head">
            <span className="ao-changes-tab" data-active="true">
              <FileIcon size={14} />
              <span>Changes</span>
              {changeCount > 0 && <span className="ao-changes-tab-count">{changeCount}</span>}
            </span>
            <span className="ao-spacer" />
            {run.source !== 'none' && (
              <>
                <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={() => void act(() => call('runsOpenFolder', run.id, 'vscode'))}>
                  VS Code
                </button>
                <button type="button" className="ao-icon-btn" onClick={() => void act(() => call('runsOpenFolder', run.id, 'folder'))} aria-label="Open the folder" title="Open the folder">
                  <FolderIcon size={14} />
                </button>
              </>
            )}
          </header>
          {run.source === 'none' ? (
            <div className="ao-changes-empty">
              <FileIcon size={22} />
              <p>Pick where the task works first — under the message box.</p>
            </div>
          ) : (
            <ChangesList run={run} onCount={setChangeCount} />
          )}
        </aside>
      </div>
    </>
  );
}

/** Where the task works, picked on the status line as a session's folder is: a company repo, or a folder here. */
function PlacePicker({ run, locked, onError }: { run: Run; locked: boolean; onError: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(run.repo);
  /** The branch to start from — empty: the repo's default. */
  const [base, setBase] = useState(run.requestedBase ?? '');
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    call('githubAllRepos').then(setRepos).catch(() => {});
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = async (place: { repo?: string; folder?: string }) => {
    onError(null);
    try {
      await call('runsSetPlace', run.id, { ...place, base });
      setOpen(false);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const pickFolder = async () => {
    const f = await call('pickFolder', 'The folder this task works in');
    if (f) await set({ folder: f });
  };

  const label = run.source === 'repo' ? run.repo : run.source === 'folder' ? baseName(run.folder ?? '') : 'Choose where it works';
  return (
    <span className="ao-place" ref={box}>
      <button
        type="button"
        className="ao-status-folder"
        data-set={run.source !== 'none'}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
        title={locked ? `${run.source === 'repo' ? run.repo : run.folder} — fixed once Claude has worked in it` : 'A company repo, or a folder on this computer'}
      >
        {run.source === 'repo' ? <BranchIcon size={12} /> : <FolderIcon size={12} />}
        <span>{label}</span>
      </button>
      {open && (
        <div className="ao-pipe-menu ao-place-menu" role="dialog" aria-label="Where it works">
          <div className="ao-pipe-setting">
            <span>Start from branch</span>
            <input className="ao-task-input ao-mono-input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="the repo’s default (e.g. develop)" />
          </div>
          <div className="ao-pipe-setting">
            <span>Company repo</span>
            <div className="ao-place-row">
              <input className="ao-task-input" list="ao-place-repos" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoFocus />
              <button type="button" className="ao-btn-primary ao-btn-compact" disabled={!repo.trim()} onClick={() => void set({ repo })}>
                Use
              </button>
            </div>
          </div>
          <datalist id="ao-place-repos">
            {repos.map((r) => (
              <option key={r.fullName} value={r.fullName} />
            ))}
          </datalist>
          <p className="ao-pipe-menu-note">Cloned through the VPN into a checkout of the task&apos;s own. A folder that&apos;s a GitHub repo gets a worktree of its own too, from origin&apos;s latest — the folder itself isn&apos;t touched.</p>
          <div className="ao-pipe-setting">
            <span>Folder on this computer</span>
            <button type="button" className="ao-btn-secondary ao-btn-compact ao-place-folder" onClick={() => void pickFolder()}>
              <FolderIcon size={13} /> Choose a folder…
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/** The task's ticket, copied from Jira: key, title, description, link. */
function TicketForm({ ticket, onSave, onCancel }: { ticket: ManualTicket; onSave: (t: Partial<ManualTicket>) => void; onCancel: () => void }) {
  const [key, setKey] = useState(ticket.key);
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description);
  const [url, setUrl] = useState(ticket.url ?? '');
  return (
    <div className="ao-ticket-form">
      <div className="ao-task-panel-grid ao-ticket-grid">
        <label className="ao-task-panel-field">
          <span className="ao-task-panel-label">Ticket key</span>
          <input className="ao-task-input ao-mono-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BF9-123" />
        </label>
        <label className="ao-task-panel-field">
          <span className="ao-task-panel-label">Title</span>
          <input className="ao-task-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="ao-task-panel-field">
        <span className="ao-task-panel-label">Description — what the workflow works from; pasted from Jira</span>
        <textarea className="ao-task-input ao-task-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="ao-task-panel-field">
        <span className="ao-task-panel-label">Link</span>
        <input className="ao-task-input ao-mono-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/browse/BF9-123" />
      </label>
      <div className="ao-task-panel-actions">
        <button type="button" className="ao-btn-primary ao-btn-compact" onClick={() => onSave({ key, title, description, url })}>
          Save
        </button>
        <button type="button" className="ao-btn-secondary ao-btn-compact" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
