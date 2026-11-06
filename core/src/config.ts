import fs from 'node:fs';
import path from 'node:path';

/**
 * Where AI Worker keeps its own files — settings, sealed secrets, its own
 * Claude config folder. Set once by the desktop app before anything else
 * touches the disk; nothing here is shared with any other app.
 */
let dataRoot: string | null = null;

export function setDataRoot(dir: string): void {
  dataRoot = dir;
  fs.mkdirSync(dir, { recursive: true });
}

export function getDataRoot(): string {
  if (!dataRoot) throw new Error('Data root not set');
  return dataRoot;
}

export function dataPath(...parts: string[]): string {
  return path.join(getDataRoot(), ...parts);
}

/** A JSON file under the data root, read with defaults filled in. */
export function readJson<T extends object>(name: string, defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(dataPath(name), 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

/** Written whole, through a temp file, so a crash never leaves half a file. */
export function writeJson(name: string, value: unknown): void {
  const file = dataPath(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
