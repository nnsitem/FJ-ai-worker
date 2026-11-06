import { execSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { runInGroup } from '../../core/src/processes';

const alive = (tag: string) => execSync(`pgrep -f '${tag}' || true`).toString().trim() !== '';

describe.skipIf(process.platform === 'win32')('runInGroup', () => {
  it('Stop ends the command and what it started', async () => {
    const tag = `sleep 4${Math.floor(Math.random() * 90 + 10)}`;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const t0 = Date.now();
    const res = await runInGroup('/bin/sh', ['-c', `${tag} & ${tag}; echo never`], { cwd: os.tmpdir(), env: process.env, signal: ac.signal, timeoutMs: 60000, maxBytes: 1000 });
    expect(res.why).toBe('stopped');
    expect(Date.now() - t0).toBeLessThan(3000);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(tag)).toBe(false);
  });

  it('a finished command leaves nothing behind in its group', async () => {
    const tag = `sleep 5${Math.floor(Math.random() * 90 + 10)}`;
    const ac = new AbortController();
    const res = await runInGroup('/bin/sh', ['-c', `(${tag} &) ; echo hi`], { cwd: os.tmpdir(), env: process.env, signal: ac.signal, timeoutMs: 60000, maxBytes: 1000 });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('hi');
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(tag)).toBe(false);
  });
});
