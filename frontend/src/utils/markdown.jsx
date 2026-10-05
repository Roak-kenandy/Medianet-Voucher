/*
 * A small Markdown renderer for the documents this portal ships itself (the API guide):
 * headings, paragraphs, lists, tables, fenced code, and inline code, bold and links.
 * It builds React elements and never injects HTML, so document text cannot run as markup.
 */

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text, onLink, keyPrefix = 'i') {
  const parts = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key}>{renderInline(token.slice(2, -2), onLink, key)}</strong>);
    } else {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      parts.push(
        <a
          key={key}
          href={href}
          onClick={(event) => {
            if (onLink && onLink(href) !== false) event.preventDefault();
          }}
        >
          {renderInline(label, onLink, key)}
        </a>
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

const isListItem = (line) => /^\s*([-*]|\d+\.)\s+/.test(line);

/** Parses the text into blocks: { type, ... }. */
export function parseMarkdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      blocks.push({ type: 'code', language: fence[1] || '', text: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim(), id: slugify(heading[2]) });
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (isListItem(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (isListItem(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !isListItem(lines[i]) &&
      !(lines[i].trim().startsWith('|') && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] || ''))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

export default function Markdown({ blocks, onLink }) {
  return blocks.map((block, index) => {
    const key = `b-${index}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${Math.min(block.level + 1, 5)}`;
        return (
          <Tag key={key} id={block.id} className={`doc-h${block.level}`}>
            {renderInline(block.text, onLink, key)}
          </Tag>
        );
      }
      case 'code':
        return (
          <pre key={key} className="doc-code">
            <code>{block.text}</code>
          </pre>
        );
      case 'table':
        return (
          <div key={key} className="table-wrapper doc-table">
            <table className="table">
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c}>{renderInline(cell, onLink, `${key}-h${c}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{renderInline(cell, onLink, `${key}-${r}-${c}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag key={key} className="doc-list">
            {block.items.map((item, n) => (
              <li key={n}>{renderInline(item, onLink, `${key}-${n}`)}</li>
            ))}
          </Tag>
        );
      }
      default:
        return (
          <p key={key} className="doc-p">
            {renderInline(block.text, onLink, key)}
          </p>
        );
    }
  });
}
