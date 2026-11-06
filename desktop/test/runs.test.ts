import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: () => null }));
const { FORBIDDEN_BASH } = await import('../../core/src/runs.js');

describe('FORBIDDEN_BASH (what Claude may not run while fixing)', () => {
  it.each([
    'git push',
    'git push origin HEAD',
    'git commit -m "x"',
    'npm test && git commit -am wip',
    'cd src; git checkout main',
    'git switch -c other',
    'git reset --hard HEAD~1',
    'git branch -D fix/x',
    'gh pr create',
    '(git stash)',
  ])('refuses %s', (cmd) => expect(FORBIDDEN_BASH.test(cmd)).toBe(true));

  it.each(['npm test', 'git status', 'git diff', 'git log --oneline -5', 'npx vitest run src/a.test.ts', 'grep -r github .'])('allows %s', (cmd) =>
    expect(FORBIDDEN_BASH.test(cmd)).toBe(false),
  );
});
