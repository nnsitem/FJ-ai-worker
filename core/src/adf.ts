/**
 * Jira Cloud's rich text (Atlassian Document Format) as plain text with a
 * little Markdown — for reading in the app, and for handing a ticket to
 * Claude (M3). Unknown nodes keep their text; nothing is dropped silently.
 */
export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
};

export function adfToText(doc: unknown): string {
  if (doc == null) return '';
  if (typeof doc === 'string') return doc;
  return block(doc as AdfNode).replace(/\n{3,}/g, '\n\n').trim();
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes ?? []).map(inlineNode).join('');
}

function inlineNode(n: AdfNode): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'text':
      return n.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return String(a.text ?? '@someone');
    case 'emoji':
      return String(a.text ?? a.shortName ?? '');
    case 'inlineCard':
    case 'blockCard':
      return String(a.url ?? '');
    case 'date':
      return a.timestamp ? new Date(Number(a.timestamp)).toISOString().slice(0, 10) : '';
    case 'status':
      return `[${String(a.text ?? '')}]`;
    case 'media':
    case 'mediaInline':
      return `[attachment${a.alt ? `: ${String(a.alt)}` : ''}]`;
    default:
      return n.content ? inline(n.content) : (n.text ?? '');
  }
}

function block(n: AdfNode, depth = 0): string {
  const a = n.attrs ?? {};
  const kids = n.content ?? [];
  const indent = '  '.repeat(depth);
  switch (n.type) {
    case 'doc':
      return kids.map((k) => block(k, depth)).join('');
    case 'paragraph':
      return `${inline(kids)}\n\n`;
    case 'heading':
      return `${'#'.repeat(Number(a.level) || 1)} ${inline(kids)}\n\n`;
    case 'bulletList':
    case 'orderedList':
      return (
        kids
          .map((item, i) => {
            const mark = n.type === 'orderedList' ? `${i + 1}.` : '-';
            const body = (item.content ?? []).map((c) => (c.type === 'paragraph' ? inline(c.content) : `\n${block(c, depth + 1).trimEnd()}`)).join('\n');
            return `${indent}${mark} ${body}`;
          })
          .join('\n') + '\n\n'
      );
    case 'taskList':
      return kids.map((t) => `${indent}- [${t.attrs?.state === 'DONE' ? 'x' : ' '}] ${inline(t.content)}`).join('\n') + '\n\n';
    case 'codeBlock':
      return `\`\`\`${String(a.language ?? '')}\n${inline(kids)}\n\`\`\`\n\n`;
    case 'blockquote':
    case 'panel':
      return kids.map((k) => block(k, depth)).join('').trimEnd().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
    case 'rule':
      return '---\n\n';
    case 'table':
      return kids.map((row) => `| ${(row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c).trim()).join(' ')).join(' | ')} |`).join('\n') + '\n\n';
    case 'mediaSingle':
    case 'mediaGroup':
      return `${kids.map(inlineNode).join(' ')}\n\n`;
    case 'expand':
    case 'nestedExpand':
      return `${a.title ? `**${String(a.title)}**\n` : ''}${kids.map((k) => block(k, depth)).join('')}`;
    default:
      return kids.length ? kids.map((k) => block(k, depth)).join('') : `${inlineNode(n)}\n\n`;
  }
}

/** Plain text (Markdown-ish) as an ADF document — for comments the app writes (M3). */
export function textToAdf(text: string): AdfNode & { version: 1 } {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return {
    version: 1,
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: p.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
    })),
  };
}
