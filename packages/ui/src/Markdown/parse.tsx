/**
 * Parser de um SUBCONJUNTO seguro de Markdown -> elementos React (F38-S04/S05).
 *
 * NUNCA usa dangerouslySetInnerHTML; nenhum HTML cru do corpo e jamais
 * interpretado. Tudo que o autor escreve vira texto ou um elemento da allowlist
 * abaixo. Isso elimina XSS de forma ESTRUTURAL (nao por filtragem): mesmo que o
 * corpo contenha `<script>`, `<img onerror=...>` ou `<iframe>`, eles aparecem
 * como texto literal escapado pelo React, nunca como nodes ativos.
 *
 * Blocos suportados: heading, paragrafo, lista (com marcador ou numerada),
 * blockquote, code fence, regra horizontal. Inline: strong, em, code, links
 * [texto](url) e autolinks. Todo link passa por sanitizeUrl.
 */
import { Fragment, type ReactNode } from 'react';
import { sanitizeUrl } from './sanitize';

// ─── Inline ──────────────────────────────────────────────────────────────────

let keySeq = 0;
function k(): string {
  keySeq += 1;
  return `md-${keySeq}`;
}

/** Tokeniza inline: code > link/autolink > strong > em, com fallback texto. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rest = text;

  // Regex de cada construtor inline (ordem importa: code primeiro = literal).
  // Grupos: 1 code, 2 link, 3 autolink, 4/5 strong, 6/7 em.
  const INLINE =
    /(`[^`]+`)|(\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))|(<https?:\/\/[^>\s]+>)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(rest)) !== null) {
    if (m.index > lastIndex) out.push(<Fragment key={k()}>{rest.slice(lastIndex, m.index)}</Fragment>);
    const tok = m[0];
    if (m[1]) {
      out.push(<code key={k()}>{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      const inner = tok.slice(1, tok.indexOf(']'));
      const urlPart = tok.slice(tok.indexOf('(') + 1, tok.length - 1).trim();
      const url = urlPart.split(/\s+/)[0] ?? '';
      const href = sanitizeUrl(url);
      out.push(
        <a key={k()} href={href} rel="nofollow noopener noreferrer" target="_blank">
          {renderInline(inner)}
        </a>,
      );
    } else if (m[3]) {
      const url = tok.slice(1, -1);
      out.push(
        <a key={k()} href={sanitizeUrl(url)} rel="nofollow noopener noreferrer" target="_blank">
          {url}
        </a>,
      );
    } else if (m[4] || m[5]) {
      out.push(<strong key={k()}>{renderInline(tok.slice(2, -2))}</strong>);
    } else if (m[6] || m[7]) {
      out.push(<em key={k()}>{renderInline(tok.slice(1, -1))}</em>);
    }
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < rest.length) out.push(<Fragment key={k()}>{rest.slice(lastIndex)}</Fragment>);
  return out;
}

// ─── Blocos ────────────────────────────────────────────────────────────────

interface ListItem {
  text: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;

/** Quebra o corpo em blocos e renderiza cada um. Retorna nodes prontos. */
export function parseBlocks(md: string): ReactNode[] {
  keySeq = 0;
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // code fence
    if (FENCE.test(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // consome fence de fechamento
      blocks.push(
        <pre key={k()}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push(<hr key={k()} />);
      i += 1;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const level = (h[1] ?? '#').length;
      const content = renderInline(h[2] ?? '');
      const Tag = `h${level}` as 'h1';
      blocks.push(<Tag key={k()}>{content}</Tag>);
      i += 1;
      continue;
    }

    // blockquote (agrupa linhas consecutivas)
    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        buf.push((QUOTE.exec(lines[i] ?? '')?.[1] ?? '').trim());
        i += 1;
      }
      blocks.push(
        <blockquote key={k()}>
          {parseBlocks(buf.join('\n'))}
        </blockquote>,
      );
      continue;
    }

    // listas (agrupa)
    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line) && !UL.test(line);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const mm = ordered ? OL.exec(cur) : UL.exec(cur);
        if (!mm) break;
        items.push({ text: mm[1] ?? '' });
        i += 1;
      }
      const children = items.map((it) => <li key={k()}>{renderInline(it.text)}</li>);
      blocks.push(ordered ? <ol key={k()}>{children}</ol> : <ul key={k()}>{children}</ul>);
      continue;
    }

    // paragrafo: junta linhas ate blank/bloco
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (
        cur.trim() === '' ||
        HEADING.test(cur) ||
        HR.test(cur) ||
        UL.test(cur) ||
        OL.test(cur) ||
        QUOTE.test(cur) ||
        FENCE.test(cur)
      ) {
        break;
      }
      para.push(cur.trim());
      i += 1;
    }
    blocks.push(<p key={k()}>{renderInline(para.join(' '))}</p>);
  }

  return blocks;
}
