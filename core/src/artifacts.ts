import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, readJson, writeJson } from './config.js';

/**
 * Artifacts, as in AI Office: the documents Claude writes while working a
 * task — reports, notes, Markdown, CSVs, images, PDFs — copied into the
 * app's own data so they can be read back later, whatever happens to the
 * file on disk. One copy per distinct content: writing the file again with
 * different content adds a version; the same content adds nothing.
 *
 * Source code isn't collected — that's the task's Changes (git).
 */

const KINDS: Record<string, ArtifactKind> = {
  md: 'doc', markdown: 'doc', txt: 'doc', html: 'doc', htm: 'doc', rst: 'doc', adoc: 'doc',
  csv: 'data', tsv: 'data', xlsx: 'data', xls: 'data',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  pdf: 'pdf',
  docx: 'office', pptx: 'office',
};
const TEXT = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'rst', 'adoc', 'csv', 'tsv', 'svg']);
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};
/** Files the code's own folders are full of, never a task's document. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', 'vendor', '.venv', 'target', '.gradle']);
const SKIP_NAMES = /^(README|CHANGELOG|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT)\b/i;
const MAX_BYTES = 20 * 1024 * 1024;

export type ArtifactKind = 'doc' | 'data' | 'image' | 'pdf' | 'office';
export type ArtifactVersion = { hash: string; at: string; size: number; file: string };
export type Artifact = {
  id: string;
  name: string;
  /** Where it was, inside the task's folder. */
  relPath: string;
  taskId: string;
  taskTitle: string;
  kind: ArtifactKind;
  ext: string;
  versions: ArtifactVersion[];
  updatedAt: string;
};

const INDEX = 'artifacts.json';
const store = () => {
  const d = dataPath('artifacts');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export const artifactKind = (file: string): ArtifactKind | null => KINDS[path.extname(file).slice(1).toLowerCase()] ?? null;

export function listArtifacts(): Artifact[] {
  return readJson<{ items: Artifact[] }>(INDEX, { items: [] }).items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * After a Claude turn: keeps the documents it wrote — those its Write/Edit
 * calls named, and any document file in the folder changed since the turn
 * began (a shell command's output). Files that would be part of the code
 * (README, LICENSE…) a tool edited are left to git.
 */
export function collectArtifacts(
  task: { id: string; title: string },
  root: string,
  written: string[],
  since: number,
  /** In a git checkout: the paths git sees changed or new — nothing else is a document of the task's (a fresh checkout's files are all "new"). */
  changed: Set<string> | null = null,
): number {
  const found = new Set<string>();
  for (const f of written) {
    const abs = path.resolve(root, f);
    if (artifactKind(abs) && !SKIP_NAMES.test(path.basename(abs))) found.add(abs);
  }
  // Shell-made files: a bounded walk of the folder for recent documents.
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || seen > 20000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      seen++;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
      } else if (artifactKind(e.name) && !SKIP_NAMES.test(e.name)) {
        const abs = path.join(dir, e.name);
        try {
          if (fs.statSync(abs).mtimeMs >= since) found.add(abs);
        } catch {
          // gone already
        }
      }
    }
  };
  walk(root, 0);

  const index = readJson<{ items: Artifact[] }>(INDEX, { items: [] });
  let added = 0;
  for (const abs of found) {
    if (changed && !changed.has(path.relative(root, abs).split(path.sep).join('/'))) continue;
    let buf: Buffer;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    const relPath = path.relative(root, abs) || path.basename(abs);
    if (relPath.startsWith('..')) continue;
    const id = createHash('sha1').update(`${task.id}\0${relPath}`).digest('hex').slice(0, 16);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 20);
    const ext = path.extname(abs).slice(1).toLowerCase();
    let a = index.items.find((x) => x.id === id);
    if (a?.versions.some((v) => v.hash === hash)) continue;
    const file = `${id}-${hash}.${ext}`;
    fs.writeFileSync(path.join(store(), file), buf);
    const at = new Date().toISOString();
    if (!a) {
      a = { id, name: path.basename(abs), relPath, taskId: task.id, taskTitle: task.title, kind: artifactKind(abs)!, ext, versions: [], updatedAt: at };
      index.items.push(a);
    }
    a.versions.push({ hash, at, size: buf.length, file });
    a.taskTitle = task.title;
    a.updatedAt = at;
    added++;
  }
  if (added) writeJson(INDEX, index);
  return added;
}

function find(id: string, hash?: string): { a: Artifact; v: ArtifactVersion } {
  const a = listArtifacts().find((x) => x.id === id);
  if (!a) throw new Error('No such artifact');
  const v = hash ? a.versions.find((x) => x.hash === hash) : a.versions.at(-1);
  if (!v) throw new Error('No such version');
  return { a, v };
}

/** A version's content for the window: text as text, images and PDFs as a data: URL. */
export function artifactContent(id: string, hash?: string): { text: string | null; dataUrl: string | null } {
  const { a, v } = find(id, hash);
  const buf = fs.readFileSync(path.join(store(), v.file));
  if (TEXT.has(a.ext) && a.ext !== 'svg') return { text: buf.toString('utf8'), dataUrl: null };
  if (MIME[a.ext]) return { text: null, dataUrl: `data:${MIME[a.ext]};base64,${buf.toString('base64')}` };
  return { text: null, dataUrl: null };
}

/** The stored copy's path (to open in its own app, or save elsewhere). */
export function artifactFile(id: string, hash?: string): { path: string; name: string } {
  const { a, v } = find(id, hash);
  return { path: path.join(store(), v.file), name: a.name };
}

export function deleteArtifact(id: string): void {
  const index = readJson<{ items: Artifact[] }>(INDEX, { items: [] });
  const a = index.items.find((x) => x.id === id);
  if (!a) return;
  for (const v of a.versions) fs.rmSync(path.join(store(), v.file), { force: true });
  index.items = index.items.filter((x) => x.id !== id);
  writeJson(INDEX, index);
}
