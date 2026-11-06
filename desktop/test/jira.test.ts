import { describe, expect, it, vi } from 'vitest';
import { adfToText, textToAdf } from '../../core/src/adf.js';

vi.mock('../../core/src/settings.js', () => ({
  getSettings: () => ({ jira: { site: '', email: '' }, projects: [] }),
  repoForProject: () => null,
  saveSettings: () => ({}),
  normaliseSite: (s: string) => s,
}));
const { filterJql } = await import('../../core/src/jira.js');

describe('adfToText', () => {
  it('reads paragraphs, headings, lists and code', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Open ' }, { type: 'mention', attrs: { text: '@Ann' } }, { type: 'hardBreak' }, { type: 'text', text: 'then' }] },
        { type: 'orderedList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ] },
        { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: 'select 1' }] },
      ],
    };
    expect(adfToText(doc)).toBe('## Steps\n\nOpen @Ann\nthen\n\n1. one\n2. two\n\n```sql\nselect 1\n```');
  });

  it('takes nothing and plain strings', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText('plain')).toBe('plain');
  });

  it('round-trips plain text through textToAdf', () => {
    expect(adfToText(textToAdf('a\nb\n\nc'))).toBe('a\nb\n\nc');
  });
});

describe('filterJql', () => {
  it('defaults to my open tickets', () => {
    expect(filterJql({})).toBe('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');
  });
  it('narrows by project and quotes search text', () => {
    expect(filterJql({ scope: 'open', projects: ['BF9'], text: 'say "hi"' })).toBe(
      'statusCategory != Done AND project in ("BF9") AND text ~ "say \\"hi\\"" ORDER BY updated DESC',
    );
  });
  it('takes a ticket key as a key', () => {
    expect(filterJql({ text: 'bf9-12' })).toContain('key = "BF9-12"');
  });
  it('uses written JQL as is', () => {
    expect(filterJql({ scope: 'jql', jql: ' project = X ' })).toBe('project = X');
    expect(() => filterJql({ scope: 'jql', jql: '' })).toThrow();
  });
});
