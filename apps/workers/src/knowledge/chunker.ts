/**
 * Chunking determinístico markdown-aware da Knowledge Base (F3-S03).
 *
 * Quebra o `raw_content` em chunks respeitando a hierarquia de headings markdown
 * (#, ##, ...) e um limite alvo de tokens (~512) com overlap, gerando para cada
 * chunk: `chunkIndex`, `content`, `contentTokens` (estimativa) e `metadata` com o
 * `headingPath` (para citações legíveis em F3-S07).
 *
 * Determinístico de propósito: reprocessar o mesmo documento produz exatamente os
 * mesmos chunks (mesma ordem/índices), o que torna o reprocesso reprodutível e a
 * idempotência trivial (apaga + reinsere).
 *
 * A contagem de tokens é uma ESTIMATIVA barata (~4 chars/token), não tokenização
 * real — suficiente para dimensionar chunks; o custo/uso real vem da OpenAI no
 * embed. Sem dependência externa (tiktoken) de propósito.
 */

/** ~4 caracteres por token (heurística estável p/ pt-BR/markdown). */
const CHARS_PER_TOKEN = 4;
/** Alvo de tokens por chunk. */
const TARGET_TOKENS = 512;
/** Overlap entre chunks adjacentes (continuidade de contexto). */
const OVERLAP_TOKENS = 64;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export interface DocumentChunk {
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentTokens: number;
  readonly metadata: { readonly headingPath: string[] };
}

/** Estima tokens a partir do tamanho em chars (>=1 para conteúdo não-vazio). */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_TOKEN));
}

interface Section {
  readonly headingPath: string[];
  readonly text: string;
}

/** Nível de um heading markdown (`#` -> 1, `##` -> 2...) ou 0 se não for heading. */
function headingLevel(line: string): number {
  const match = /^(#{1,6})\s+/.exec(line);
  return match ? match[1]!.length : 0;
}

/**
 * Segmenta o markdown em seções por heading, carregando o caminho de headings
 * (heading path) acumulado até cada seção.
 */
function splitIntoSections(raw: string): Section[] {
  const lines = raw.split(/\r?\n/);
  const sections: Section[] = [];
  const headingStack: { level: number; title: string }[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      sections.push({ headingPath: headingStack.map((h) => h.title), text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const level = headingLevel(line);
    if (level > 0) {
      flush();
      // Desempilha headings de nível >= ao atual (novo ramo da árvore).
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      const title = line.replace(/^#{1,6}\s+/, '').trim();
      headingStack.push({ level, title });
      // A própria linha de heading entra no conteúdo do chunk (contexto).
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Quebra um texto longo em janelas de ~TARGET_CHARS com OVERLAP_CHARS de
 * sobreposição, tentando cortar em fronteira de parágrafo/linha quando possível.
 */
function windowText(text: string): string[] {
  if (text.length <= TARGET_CHARS) return [text];
  const windows: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + TARGET_CHARS, text.length);
    if (end < text.length) {
      // Procura uma quebra de parágrafo/linha "para trás" a partir de `end`.
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
      if (lastBreak > TARGET_CHARS * 0.5) {
        end = start + lastBreak;
      }
    }
    windows.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return windows.filter((w) => w.length > 0);
}

/**
 * Chunking principal: seções por heading -> janelas por tamanho -> chunks
 * indexados sequencialmente. Documento vazio -> `[]`.
 */
export function chunkDocument(rawContent: string): DocumentChunk[] {
  const sections = splitIntoSections(rawContent);
  const chunks: DocumentChunk[] = [];
  let index = 0;
  for (const section of sections) {
    for (const window of windowText(section.text)) {
      chunks.push({
        chunkIndex: index,
        content: window,
        contentTokens: estimateTokens(window),
        metadata: { headingPath: section.headingPath },
      });
      index += 1;
    }
  }
  return chunks;
}
