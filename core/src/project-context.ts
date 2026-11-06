import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './config.js';

/**
 * Project context, as in AI Office: what Claude should know about one
 * codebase before it works on it — its stack, its database, the conventions
 * not to "fix", the bugs that keep coming back. One Markdown note per project
 * (a GitHub owner/name, or a folder of its own), kept in the app's data and
 * edited under Agents & skills › Project context.
 *
 * Every Claude turn in a task about that project is given the note (and its
 * path as AI_PROJECT_CONTEXT / AI_REVIEW_CONTEXT, which the library's
 * reviewer reads). Which project a task is about: its repo; for a folder,
 * the GitHub repo its origin points at, else the folder itself.
 */

export type ProjectContext = { project: string; text: string; updatedAt: string | null };

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const dir = () => dataPath('project-context');
const fileFor = (project: string) => path.join(dir(), `${Buffer.from(project).toString('base64url')}.md`);

/** A project key: owner/name, or "folder:" and an absolute path. */
function clean(project: string): string {
  const p = project.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (REPO_RE.test(p) || /^folder:\//.test(p) || /^folder:[A-Za-z]:\\/.test(p)) return p;
  throw new Error('Use a GitHub repo (owner/name) or a folder');
}

export function listProjectContexts(): ProjectContext[] {
  if (!fs.existsSync(dir())) return [];
  return fs
    .readdirSync(dir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(dir(), f);
      return { project: Buffer.from(f.slice(0, -3), 'base64url').toString(), text: fs.readFileSync(full, 'utf8'), updatedAt: fs.statSync(full).mtime.toISOString() };
    })
    .sort((a, b) => a.project.localeCompare(b.project));
}

export function saveProjectContext(project: string, text: string): ProjectContext {
  const p = clean(project);
  const body = String(text ?? '').slice(0, 60_000);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileFor(p), body);
  return { project: p, text: body, updatedAt: new Date().toISOString() };
}

export function deleteProjectContext(project: string): void {
  fs.rmSync(fileFor(clean(project)), { force: true });
}

/** The GitHub owner/name a folder's origin points at, if it does. */
function githubOrigin(folder: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile('git', ['config', '--get', 'remote.origin.url'], { cwd: folder, timeout: 5000 }, (err, out) => {
      const m = !err && /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/.exec(out);
      resolve(m ? m[1] : null);
    }),
  );
}

/** Which project a task is about. */
export async function taskProject(t: { source: string; repo: string; folder: string | null }): Promise<string | null> {
  if (t.source === 'repo' && t.repo) return t.repo;
  if (t.source === 'folder' && t.folder) return (await githubOrigin(t.folder)) ?? `folder:${t.folder}`;
  return null;
}

/** The project's note for a Claude turn: its text, and the variables pointing at it. */
export function projectNote(project: string | null): { text: string; env: Record<string, string> } | null {
  if (!project) return null;
  const file = fileFor(project);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return null;
  return { text, env: { AI_PROJECT: project, AI_PROJECT_CONTEXT: file, AI_REVIEW_CONTEXT: file } };
}

export const PROJECT_CONTEXT_TEMPLATE = `# <project> — context for AI agents

## Stack
- Frameworks, languages, how it's built and run.

## Database
- Which database, where migrations live, what matters about it.

## Conventions (don't "fix" these)
- Patterns that look odd but are intended.

## Known pitfalls
- Bugs that keep coming back, things easy to break.

## Review focus
- What a reviewer should always check on this project.
`;
