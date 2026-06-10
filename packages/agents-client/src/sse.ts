/**
 * Parser SSE (`text/event-stream`) incremental, sem dependências.
 *
 * O runtime emite eventos como `data: <json>\n\n` (LangServe / FastAPI
 * StreamingResponse — `AGENTS_LANGGRAPH.md` §3.5, §10.1). Este módulo decodifica
 * um `ReadableStream<Uint8Array>` (corpo do `fetch`) em frames de `data`,
 * lidando com chunks que cortam linhas no meio e múltiplos campos `data:` por
 * evento (concatenados com `\n`, conforme a spec WHATWG SSE).
 *
 * Não interpreta o JSON — só extrai o payload `data`. A validação Zod fica no
 * cliente, no boundary. Linhas de comentário (`:`) e o terminador `[DONE]` são
 * sinalizados para o chamador decidir.
 */

import { AgentRuntimeError } from './errors';

/** Sentinela opcional de fim de stream (convenção OpenAI/SSE). */
export const SSE_DONE = '[DONE]' as const;

/**
 * Itera os payloads `data:` de um corpo SSE. Yields a string crua de cada
 * frame `data` (já sem o prefixo). Não emite `[DONE]` — encerra ao vê-lo.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Eventos são separados por uma linha em branco (\n\n). Normaliza CRLF.
      let sepIndex = indexOfSeparator(buffer);
      while (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex.index);
        buffer = buffer.slice(sepIndex.index + sepIndex.length);

        const data = extractData(rawEvent);
        if (data !== undefined) {
          if (data === SSE_DONE) return;
          yield data;
        }
        sepIndex = indexOfSeparator(buffer);
      }
    }

    // Flush final: um último evento sem \n\n terminal (stream fechou limpo).
    const tail = (buffer + decoder.decode()).trim();
    if (tail.length > 0) {
      const data = extractData(tail);
      if (data !== undefined && data !== SSE_DONE) yield data;
    }
  } catch (err: unknown) {
    throw AgentRuntimeError.stream('connection interrupted while reading SSE', err);
  } finally {
    reader.releaseLock();
  }
}

/** Acha o primeiro separador de evento (`\n\n` ou `\r\n\r\n`). */
function indexOfSeparator(buffer: string): { index: number; length: number } | -1 {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (crlf === -1 || (lf !== -1 && lf < crlf)) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

/**
 * Extrai o payload `data` de um bloco de evento SSE. Concatena múltiplas
 * linhas `data:` com `\n` (spec WHATWG). Ignora comentários (`:`) e campos
 * `event:`/`id:`/`retry:` que o runtime não usa no MVP. Retorna `undefined`
 * para eventos sem `data` (ex.: keep-alive comment).
 */
function extractData(rawEvent: string): string | undefined {
  const lines = rawEvent.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmedEnd = line.replace(/\r$/, '');
    if (trimmedEnd.length === 0 || trimmedEnd.startsWith(':')) continue;
    if (trimmedEnd.startsWith('data:')) {
      // Spec: remove um único espaço após o ':'.
      const value = trimmedEnd.slice('data:'.length);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    // Campos não-data (event/id/retry) são ignorados no MVP.
  }

  if (dataLines.length === 0) return undefined;
  return dataLines.join('\n');
}
