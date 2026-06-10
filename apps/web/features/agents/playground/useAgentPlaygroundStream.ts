'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSseEvent, type PlaygroundError, type SseEvent, type TranscriptTurn } from './types';

/**
 * Hook de streaming do Playground (F2-S19).
 *
 * Consome `POST /api/agents/:id/playground` via `fetch` + `ReadableStream` reader
 * (EventSource não pode fazer POST nem enviar body — precisamos do reader). Parseia
 * frames SSE (`data: <json>\n\n`) e projeta os eventos do runtime em `TranscriptTurn[]`:
 *  - `token`        → acumula na bolha do assistente (cursor de streaming).
 *  - `tool_call_*`  → chips (running → done com duração).
 *  - `final`        → fixa a reply + usage/custo, encerra o streaming.
 *  - `error`/`budget_exceeded`/`model_blocked`/`iteration_exceeded`/`interrupt` →
 *    estado terminal 3-partes (com ref copiável quando o frame trouxer).
 *
 * `AbortController` cancela a leitura (e, via `req.on('close')` no servidor, o
 * stream upstream do runtime) ao desmontar ou ao re-enviar.
 */

// No browser: mesma origem (o Next proxia /api → API), cookie de sessão first-party.
const BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

let turnSeq = 0;
const nextId = (prefix: string): string => `${prefix}-${(turnSeq += 1)}-${Date.now().toString(36)}`;

/** Extrai uma ref `hm-…` da mensagem de erro do frame (a API a injeta como "(ref …)"). */
function extractRef(message: string): string | undefined {
  const match = /\(ref\s+([^)]+)\)/.exec(message);
  return match?.[1]?.trim();
}

/** Mapeia eventos terminais de erro/bloqueio em um `PlaygroundError` 3-partes. */
function toError(ev: SseEvent): PlaygroundError | null {
  switch (ev.type) {
    case 'error':
      return {
        title: 'Falha ao executar o agente',
        reason: ev.message.replace(/\s*\(ref\s+[^)]+\)\s*$/, '').trim() || undefined,
        reference: extractRef(ev.message),
      };
    case 'budget_exceeded':
      return {
        title: 'Orçamento de IA esgotado',
        reason:
          'O cap mensal de custo de IA deste workspace foi atingido. Ajuste a policy para continuar testando.',
      };
    case 'model_blocked':
      return {
        title: 'Modelo bloqueado pela policy',
        reason: ev.reason,
      };
    case 'iteration_exceeded':
      return {
        title: 'Limite de iterações atingido',
        reason: 'O agente excedeu o número máximo de passos permitido pela policy.',
      };
    case 'interrupt':
      return {
        title: 'Agente pausado para aprovação',
        reason: `O agente solicitou rodar a tool "${ev.tool_key}" e precisa de aprovação humana (${ev.reason}). No playground não há fluxo de aprovação — em produção a conversa seria escalada.`,
      };
    default:
      return null;
  }
}

export interface PlaygroundStream {
  readonly turns: TranscriptTurn[];
  readonly isStreaming: boolean;
  readonly error: PlaygroundError | null;
  /** Envia um turno do usuário e abre o stream. */
  send(userInput: string): void;
  /** Cancela o stream em voo (se houver). */
  cancel(): void;
  /** Limpa o transcript e o erro. */
  reset(): void;
}

export function useAgentPlaygroundStream(agentId: string): PlaygroundStream {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<PlaygroundError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Aplica um evento parseado ao turno do assistente corrente (último). */
  const applyEvent = useCallback((assistantId: string, ev: SseEvent): boolean => {
    const terminalError = toError(ev);
    if (terminalError) {
      setError(terminalError);
      setTurns((prev) =>
        prev.map((t) => (t.id === assistantId ? { ...t, streaming: false } : t)),
      );
      return true; // terminal
    }

    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== assistantId) return t;
        switch (ev.type) {
          case 'token':
            return { ...t, text: t.text + ev.content };
          case 'tool_call_started':
            return {
              ...t,
              toolCalls: [
                ...t.toolCalls,
                { id: nextId('tool'), toolKey: ev.tool_key, status: 'running' as const },
              ],
            };
          case 'tool_call_completed': {
            // Fecha o primeiro chip running com a mesma key.
            let patched = false;
            const toolCalls = t.toolCalls.map((c) => {
              if (!patched && c.toolKey === ev.tool_key && c.status === 'running') {
                patched = true;
                return { ...c, status: 'done' as const, durationMs: ev.duration_ms };
              }
              return c;
            });
            return { ...t, toolCalls };
          }
          case 'final':
            return { ...t, text: ev.reply, usage: ev.usage, streaming: false };
          default:
            return t;
        }
      }),
    );
    return ev.type === 'final';
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  // Aborta o stream em voo ao desmontar (troca de aba/navegação): sem isso o
  // `fetch` continua aberto e o runtime segue gerando — e faturando — tokens.
  // Aborta o ref direto (não `cancel`) para não disparar setState pós-unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    cancel();
    setTurns([]);
    setError(null);
  }, [cancel]);

  const send = useCallback(
    (userInput: string) => {
      const trimmed = userInput.trim();
      if (trimmed.length === 0 || isStreaming) return;

      // Cancela qualquer stream anterior antes de abrir um novo.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);

      const assistantId = nextId('asst');
      const userTurn: TranscriptTurn = {
        id: nextId('user'),
        role: 'user',
        text: trimmed,
        toolCalls: [],
        streaming: false,
      };
      const assistantTurn: TranscriptTurn = {
        id: assistantId,
        role: 'assistant',
        text: '',
        toolCalls: [],
        streaming: true,
      };
      // Histórico = turnos já fechados (antes deste envio).
      const history = turns.map((t) => ({ role: t.role, content: t.text }));
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setIsStreaming(true);

      void (async () => {
        try {
          const res = await fetch(`${BASE_URL}/api/agents/${agentId}/playground`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            credentials: 'include',
            body: JSON.stringify({ user_input: trimmed, history }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            setError({
              title: 'Não foi possível iniciar o teste',
              reason:
                res.status === 401
                  ? 'Sua sessão expirou. Recarregue a página e entre novamente.'
                  : res.status === 403
                    ? 'Você não tem permissão para testar este agente.'
                    : `O servidor respondeu ${res.status}.`,
            });
            setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, streaming: false } : t)));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let done = false;

          while (!done) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;
            buffer += decoder.decode(value, { stream: true });

            // Frames SSE são separados por linha em branco (`\n\n`).
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const dataLine = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trimStart())
                .join('\n');
              if (dataLine.length === 0) continue;
              let json: unknown;
              try {
                json = JSON.parse(dataLine);
              } catch {
                continue; // frame malformado — ignora defensivamente.
              }
              const ev = parseSseEvent(json);
              if (!ev) continue;
              if (applyEvent(assistantId, ev)) {
                done = true;
                break;
              }
            }
          }
        } catch (err: unknown) {
          // Abort intencional (cancel/reset/unmount) não é erro de UX.
          if (controller.signal.aborted) return;
          setError({
            title: 'Conexão interrompida',
            reason:
              err instanceof Error && err.message
                ? err.message
                : 'O stream com o agente caiu. Tente novamente.',
          });
          setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, streaming: false } : t)));
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setIsStreaming(false);
          setTurns((prev) => prev.map((t) => (t.id === assistantId ? { ...t, streaming: false } : t)));
        }
      })();
    },
    [agentId, applyEvent, isStreaming, turns],
  );

  return { turns, isStreaming, error, send, cancel, reset };
}
