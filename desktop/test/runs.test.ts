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

const { planPaths, inPlan, findSecrets } = await import('../../core/src/runs.js');

describe('the plan’s files (AI review’s scope check)', () => {
  const plan = '1. Edit `src/app/calc.ts` so add() adds.\n2. Add a case to calc.test.ts.\n3. Update README.md. Version 1.2 stays.';
  const named = planPaths(plan);
  it('finds paths and file names', () => {
    expect(named).toEqual(expect.arrayContaining(['src/app/calc.ts', 'calc.test.ts', 'README.md']));
  });
  it.each([
    ['src/app/calc.ts', true],
    ['src/app/calc.test.ts', true],
    ['README.md', true],
    ['src/app/other.ts', false],
    ['package.json', false],
  ])('%s in the plan: %s', (file, want) => expect(inPlan(file, named)).toBe(want));
});

describe('findSecrets', () => {
  const diff = (line: string) => `+++ b/src/config.ts\n+${line}`;
  it.each([
    'const token = "ghp_' + 'a'.repeat(36) + '"',
    'key = AKIA' + 'ABCDEFGHIJKLMNOP',
    '-----BEGIN RSA PRIVATE KEY-----',
    'url: "https://user:hunter2xyz@github.com/org/repo.git"',
    'password = "s3cretPassw0rd"',
  ])('flags %s', (line) => expect(findSecrets(diff(line)).length).toBe(1));
  it('leaves ordinary code and removed lines alone', () => {
    expect(findSecrets('+++ b/a.ts\n+const password = process.env.DB_PASSWORD;\n-const t = "ghp_' + 'b'.repeat(36) + '"')).toEqual([]);
  });
});
