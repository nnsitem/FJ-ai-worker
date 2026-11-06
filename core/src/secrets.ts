import { readJson, writeJson } from './config.js';

/**
 * Tokens, sealed with the system keychain (Electron's safeStorage, handed in
 * by the desktop app). Kept in their own file, never in settings.json, and
 * never sent to the window — it only learns whether one is set.
 */
export type SecretBox = {
  readonly available: boolean;
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
};

let box: SecretBox | null = null;

export function setSecretBox(b: SecretBox): void {
  box = b;
}

export type SecretName = 'github.token' | 'jira.token' | 'copilot.token';

const FILE = 'secrets.json';

export function getSecret(name: SecretName): string | null {
  const sealed = readJson<Record<string, string>>(FILE, {})[name];
  if (!sealed || !box) return null;
  try {
    return box.decrypt(sealed);
  } catch {
    return null;
  }
}

export function setSecret(name: SecretName, value: string | null): void {
  if (!box) throw new Error('Keychain not ready');
  const all = readJson<Record<string, string>>(FILE, {});
  if (value == null) delete all[name];
  else all[name] = box.encrypt(value);
  writeJson(FILE, all);
}
