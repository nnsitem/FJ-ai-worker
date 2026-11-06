'use client';

import { useEffect, useState } from 'react';
import { call, type JiraProject, type ProjectLink, type RepoSummary } from '@/lib/bridge';

/**
 * Which repo each Jira project's tickets are fixed in. Both fields suggest
 * from Jira's projects and the repos GitHub reaches, and take anything typed
 * when either isn't connected yet.
 */
export function ProjectLinks({ links, onChange }: { links: ProjectLink[]; onChange: (links: ProjectLink[]) => void }) {
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  useEffect(() => {
    call('jiraProjects').then(setProjects).catch(() => {});
    call('githubAllRepos').then(setRepos).catch(() => {});
  }, []);

  const set = (i: number, patch: Partial<ProjectLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="aw-links">
      {links.length === 0 && <p className="aw-muted">No projects linked yet.</p>}
      {links.map((l, i) => (
        <div key={i} className="aw-link-row">
          <input
            className="aw-input aw-mono"
            list="aw-jira-projects"
            value={l.jiraKey}
            onChange={(e) => set(i, { jiraKey: e.target.value.toUpperCase() })}
            placeholder="Jira project, e.g. BF9"
            aria-label="Jira project key"
          />
          <span className="aw-muted" aria-hidden="true">→</span>
          <input
            className="aw-input aw-mono"
            list="aw-github-repos"
            value={l.repo}
            onChange={(e) => set(i, { repo: e.target.value })}
            placeholder="owner/repo"
            aria-label="GitHub repo"
          />
          <button type="button" className="aw-btn" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      <div className="aw-row">
        <button type="button" className="aw-btn" onClick={() => onChange([...links, { jiraKey: '', repo: '' }])}>Link a project</button>
      </div>
      <datalist id="aw-jira-projects">
        {projects.map((p) => (
          <option key={p.key} value={p.key}>{p.name}</option>
        ))}
      </datalist>
      <datalist id="aw-github-repos">
        {repos.map((r) => (
          <option key={r.fullName} value={r.fullName} />
        ))}
      </datalist>
    </div>
  );
}
