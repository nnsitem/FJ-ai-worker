import type { ReactNode } from 'react';

/**
 * A small Markdown renderer for agent replies.
 *
 * The agent writes Markdown, so showing it raw loses the structure it went to
 * the trouble of producing — lists read as run-on text and code is
 * indistinguishable from prose. This covers the subset that actually shows up
 * in replies: fenced code, headings, bullet and numbered lists, blockquotes,
 * and inline code / bold / italic / links.
 *
 * It builds React elements rather than HTML strings, so nothing in a reply can
 * inject markup no matter what the model writes. Anything it doesn't recognise
 * falls through as plain text, which is why an unsupported construct degrades
 * to exactly what was shown before instead of disappearing.
 */

// Emphasis only at word edges, as Markdown has it: `my_var_name` and
// `2 * 3 * 4` stay as written.
const INLINE =
  /(`[^`]+`|\*\*[^*]+\*\*|(?<![\w*])\*(?!\s)[^*\n]+(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)[^_\n]+(?<!\s)_(?!\w)|\[[^\]]+\]\([^)\s]+\))/g;

/** Splits one line into text and inline spans. */
function renderInline(text: string, keyPrefix: string, onCard?: (id: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE);

  parts.forEach((part, i) => {
    if (!part) return;
    const key = `${keyPrefix}-${i}`;

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push(
        <code key={key} className="ao-md-code">
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push(<strong key={key}>{onCard ? renderInline(part.slice(2, -2), key, onCard) : part.slice(2, -2)}</strong>);
      return;
    }
    if (
      ((part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))) &&
      part.length > 2
    ) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
      return;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    // Only a scheme this app actually knows how to hand off safely — Electron
    // sends these to the system browser; see main.ts's navigation handler.
    // Anything else (`javascript:`, `data:`, `app://` traversal, ...) falls
    // through to plain text instead of becoming a clickable, agent-authored
    // (or web-fetched-and-echoed) href.
    if (link && /^(https?:|mailto:)/i.test(link[2])) {
      out.push(
        <a key={key} href={link[2]} className="ao-md-link">
          {link[1]}
        </a>
      );
      return;
    }
    // "#123" — a card on the team board, when the reader can open one.
    if (onCard) {
      part.split(/(#\d{1,7}\b)/).forEach((bit, j) => {
        const m = /^#(\d{1,7})$/.exec(bit);
        if (m)
          out.push(
            <button key={`${key}-${j}`} type="button" className="ao-md-card" onClick={() => onCard(Number(m[1]))}>
              {bit}
            </button>
          );
        else if (bit) out.push(bit);
      });
      return;
    }
    out.push(part);
  });

  return out;
}

interface ListBlock {
  ordered: boolean;
  items: string[];
}

/** `onCard` makes each #123 a link to that card on the team board. */
export function Markdown({ text, onCard }: { text: string; onCard?: (id: number) => void }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: ListBlock | null = null;
  let quote: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const body = paragraph.join('\n');
    blocks.push(
      <p key={`p${blocks.length}`} className="ao-md-p">
        {renderInline(body, `p${blocks.length}`, onCard)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className="ao-md-list">
        {items.map((item, i) => (
          <li key={i}>{renderInline(item, `l${blocks.length}-${i}`, onCard)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      <blockquote key={`q${blocks.length}`} className="ao-md-quote">
        {renderInline(quote.join('\n'), `q${blocks.length}`, onCard)}
      </blockquote>
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    // Fenced code swallows everything until the closing fence, so none of the
    // other rules may run while one is open.
    if (code) {
      if (line.trimStart().startsWith('```')) {
        blocks.push(
          <pre key={`c${blocks.length}`} className="ao-md-pre">
            <code>{code.lines.join('\n')}</code>
          </pre>
        );
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      flushAll();
      code = { lang: fence[1], lines: [] };
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push(
        <p key={`h${blocks.length}`} className="ao-md-h" data-level={heading[1].length}>
          {renderInline(heading[2], `h${blocks.length}`, onCard)}
        </p>
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = !!numbered;
      const item = (bullet ?? numbered)![1];
      // A change of list kind starts a new list rather than mixing markers.
      if (list && list.ordered !== ordered) flushList();
      list = list ?? { ordered, items: [] };
      list.items.push(item);
      continue;
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  // An unterminated fence still has to render, or the reply's tail vanishes
  // — which is the normal case while a message is still streaming in.
  if (code) {
    blocks.push(
      <pre key={`c${blocks.length}`} className="ao-md-pre">
        <code>{code.lines.join('\n')}</code>
      </pre>
    );
  }
  flushAll();

  return <div className="ao-md">{blocks}</div>;
}
