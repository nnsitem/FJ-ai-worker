import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeConfigDir } from './claude-account.js';

/**
 * Agents and skills, imported (copied, once) from a folder — AI Office's
 * library or any `.claude` folder — into the app's own Claude config folder
 * (claude-account.ts): agents/<name>.md and skills/<name>/SKILL.md, where
 * Claude Code finds them as the user's own. Nothing links back to where they
 * came from; importing again replaces those of the same name.
 */

export type LibraryAgent = { name: string; description: string; model: string | null; tools: string[] | null };
export type LibrarySkill = { name: string; description: string };
export type Library = { agents: LibraryAgent[]; skills: LibrarySkill[]; aiOfficeLibrary: string | null };

const agentsDir = () => path.join(claudeConfigDir(), 'agents');
const skillsDir = () => path.join(claudeConfigDir(), 'skills');
const NAME_RE = /^[\w.-]+$/;

/** A Markdown file's YAML front matter, flat keys only, and its body. */
export function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  let key: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      meta[key] = kv[2].trim().replace(/^["']|["']$/g, '');
    } else if (key && /^\s+\S/.test(line)) {
      // a folded value or a list item continuing the key above
      meta[key] = `${meta[key]} ${line.trim().replace(/^-\s*/, '')}`.trim();
    }
  }
  return { meta, body: m[2] };
}

/** AI Office's synced library on this machine, if there is one. */
export function aiOfficeLibrary(): string | null {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'AI Office')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'AI Office')
        : path.join(os.homedir(), '.config', 'AI Office');
  const repo = path.join(base, 'agent-library', 'repo');
  return fs.existsSync(path.join(repo, '.claude')) ? repo : null;
}

export function readLibrary(): Library {
  const agents: LibraryAgent[] = [];
  for (const f of fs.existsSync(agentsDir()) ? fs.readdirSync(agentsDir()) : []) {
    if (!f.endsWith('.md')) continue;
    const { meta } = frontMatter(fs.readFileSync(path.join(agentsDir(), f), 'utf8'));
    const tools = meta.tools ? meta.tools.split(/[,\s]+/).filter(Boolean) : null;
    agents.push({ name: meta.name || f.slice(0, -3), description: meta.description ?? '', model: meta.model || null, tools });
  }
  const skills: LibrarySkill[] = [];
  for (const d of fs.existsSync(skillsDir()) ? fs.readdirSync(skillsDir()) : []) {
    const file = path.join(skillsDir(), d, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { meta } = frontMatter(fs.readFileSync(file, 'utf8'));
    skills.push({ name: meta.name || d, description: meta.description ?? '' });
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return { agents: agents.sort(byName), skills: skills.sort(byName), aiOfficeLibrary: aiOfficeLibrary() };
}

/**
 * Copies agents and skills from a folder: its `.claude/agents` and
 * `.claude/skills`, or `agents`/`skills` straight under it, or — a single
 * skill — a folder with a SKILL.md.
 */
export function importLibrary(from: string): { agents: number; skills: number } {
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) throw new Error('Pick a folder');
  const root = fs.existsSync(path.join(from, '.claude')) ? path.join(from, '.claude') : from;
  let agents = 0;
  let skills = 0;
  const srcAgents = path.join(root, 'agents');
  if (fs.existsSync(srcAgents)) {
    fs.mkdirSync(agentsDir(), { recursive: true });
    for (const f of fs.readdirSync(srcAgents)) {
      if (!f.endsWith('.md') || !NAME_RE.test(f.slice(0, -3))) continue;
      fs.copyFileSync(path.join(srcAgents, f), path.join(agentsDir(), f));
      agents++;
    }
  }
  const copySkill = (dir: string, name: string) => {
    const dest = path.join(skillsDir(), name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(dir, dest, { recursive: true, dereference: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) });
    skills++;
  };
  const srcSkills = path.join(root, 'skills');
  if (fs.existsSync(srcSkills)) {
    fs.mkdirSync(skillsDir(), { recursive: true });
    for (const d of fs.readdirSync(srcSkills)) {
      if (NAME_RE.test(d) && fs.existsSync(path.join(srcSkills, d, 'SKILL.md'))) copySkill(path.join(srcSkills, d), d);
    }
  } else if (fs.existsSync(path.join(from, 'SKILL.md'))) {
    fs.mkdirSync(skillsDir(), { recursive: true });
    copySkill(from, path.basename(from));
  }
  if (!agents && !skills) throw new Error('No agents or skills there — expected .claude/agents, .claude/skills, or a SKILL.md');
  return { agents, skills };
}

export function removeFromLibrary(kind: 'agent' | 'skill', name: string): void {
  if (!NAME_RE.test(name)) throw new Error('Not a library name');
  if (kind === 'agent') {
    for (const f of fs.existsSync(agentsDir()) ? fs.readdirSync(agentsDir()) : []) {
      if (!f.endsWith('.md')) continue;
      const file = path.join(agentsDir(), f);
      if (f.slice(0, -3) === name || frontMatter(fs.readFileSync(file, 'utf8')).meta.name === name) fs.rmSync(file);
    }
  } else fs.rmSync(path.join(skillsDir(), name), { recursive: true, force: true });
}

/** A library agent as the SDK takes it, for running the main thread as that agent. */
export function agentDefinition(name: string): { description: string; prompt: string; tools?: string[]; model?: string } | null {
  for (const f of fs.existsSync(agentsDir()) ? fs.readdirSync(agentsDir()) : []) {
    if (!f.endsWith('.md')) continue;
    const { meta, body } = frontMatter(fs.readFileSync(path.join(agentsDir(), f), 'utf8'));
    if ((meta.name || f.slice(0, -3)) !== name) continue;
    return {
      description: meta.description || name,
      prompt: body.trim(),
      ...(meta.model && meta.model !== 'inherit' ? { model: meta.model } : {}),
    };
  }
  return null;
}

/** An agent's or a skill's own text (its .md / SKILL.md), and a skill's other files. */
export function libraryItem(kind: 'agent' | 'skill', name: string): { text: string; files: string[]; path: string } {
  if (!NAME_RE.test(name)) throw new Error('Not a library name');
  if (kind === 'skill') {
    const dir = path.join(skillsDir(), name);
    const files: string[] = [];
    const walk = (d: string, rel: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else files.push(r);
      }
    };
    walk(dir, '');
    return { text: fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), files: files.sort(), path: dir };
  }
  for (const f of fs.existsSync(agentsDir()) ? fs.readdirSync(agentsDir()) : []) {
    if (!f.endsWith('.md')) continue;
    const file = path.join(agentsDir(), f);
    const text = fs.readFileSync(file, 'utf8');
    if (f.slice(0, -3) === name || frontMatter(text).meta.name === name) return { text, files: [f], path: file };
  }
  throw new Error('Not in the library');
}

/** A new, empty agent or skill to fill in (opened in the editor by the app). */
export function createLibraryItem(kind: 'agent' | 'skill', name: string, description: string): string {
  if (!NAME_RE.test(name)) throw new Error('Use letters, digits, dots, dashes or underscores');
  const head = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ').trim() || 'What it is for, and when to use it.'}\n---\n\n`;
  if (kind === 'agent') {
    fs.mkdirSync(agentsDir(), { recursive: true });
    const file = path.join(agentsDir(), `${name}.md`);
    if (fs.existsSync(file)) throw new Error('An agent of that name is already there');
    fs.writeFileSync(file, `${head}You are ${name}. Describe how this agent works here.\n`);
    return file;
  }
  const dir = path.join(skillsDir(), name);
  if (fs.existsSync(dir)) throw new Error('A skill of that name is already there');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `${head}# ${name}\n\nThe steps of the skill go here.\n`);
  return path.join(dir, 'SKILL.md');
}

/** Saves an agent's or a skill's main file as edited in the app. */
export function saveLibraryItem(kind: 'agent' | 'skill', name: string, text: string): void {
  const { path: p } = libraryItem(kind, name);
  fs.writeFileSync(kind === 'skill' ? path.join(p, 'SKILL.md') : p, text);
}

/** One of a skill's files, as text (the start of a big one). */
export function skillFile(name: string, rel: string): { text: string; truncated: boolean; bytes: number } {
  if (!NAME_RE.test(name)) throw new Error('Not a library name');
  const root = path.join(skillsDir(), name);
  const full = path.resolve(root, rel);
  if (path.relative(root, full).startsWith('..')) throw new Error('Not in the skill');
  const buf = fs.readFileSync(full);
  const LIMIT = 200 * 1024;
  const binary = buf.subarray(0, 8000).includes(0);
  return { text: binary ? '(a binary file)' : buf.subarray(0, LIMIT).toString('utf8'), truncated: !binary && buf.length > LIMIT, bytes: buf.length };
}

/** A skill's files with their sizes. */
export function skillFiles(name: string): { path: string; bytes: number }[] {
  const { files, path: dir } = libraryItem('skill', name);
  return files.map((f) => ({ path: f, bytes: fs.statSync(path.join(dir, f)).size }));
}
