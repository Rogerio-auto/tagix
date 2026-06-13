'use client';

/**
 * Hook de streaming SANDBOX do Agent Playground de plataforma (F26-S10).
 *
 * Faz POST para o proxy de plataforma `/api/platform/playground` (glue do orchestrator),
 * que roda o agente em modo sandbox (is_playground=true) -> ZERO side-effect de producao.
 * Le os frames SSE (data: <json>) via fetch + ReadableStream e projeta em transcript +
 * trace (tool calls com latencia + custo is_test). AbortController cancela ao re-enviar.
 */
import { useCallback, useRef, useState } from 'react';
import { parseSbEvent, type SbUsage, type TraceEntry } from './types';

const BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

let seq = 0;
const nextId = (p: string) => `${p}-${(seq += 1)}-${Date.now().toString(36)}`;

export interface Turn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  streaming: boolean;
  usage?: SbUsage;
}

export interface SandboxRunInput {
  workspaceId: string;
  agentId: string;
  userInput: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
}

export function useSandboxStream() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setTrace([]);
    setError(null);
    setRunning(false);
  }, []);

  const send = useCallback(async (input: SandboxRunInput) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setRunning(true);

    const userTurn: Turn = { id: nextId('u'), role: 'user', text: input.userInput, streaming: false };
    const asstId = nextId('a');
    setTurns((prev) => [...prev, userTurn, { id: asstId, role: 'assistant', text: '', streaming: true }]);

    const patchAsst = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => prev.map((t) => (t.id === asstId ? fn(t) : t)));

    try {
      const res = await fetch(`${BASE_URL}/api/platform/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          userInput: input.userInput,
          model: input.model,
          systemPrompt: input.systemPrompt,
          temperature: input.temperature,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            continue;
          }
          const ev = parseSbEvent(parsed);
          if (!ev) continue;
          if (ev.type === 'token') {
            patchAsst((t) => ({ ...t, text: t.text + ev.content }));
          } else if (ev.type === 'tool_call_started') {
            setTrace((prev) => [...prev, { id: nextId('tc'), toolKey: ev.tool_key, status: 'running' }]);
          } else if (ev.type === 'tool_call_completed') {
            setTrace((prev) => {
              const idx = prev.findIndex((e) => e.toolKey === ev.tool_key && e.status === 'running');
              if (idx === -1) {
                return [...prev, { id: nextId('tc'), toolKey: ev.tool_key, status: 'done', durationMs: ev.duration_ms }];
              }
              const copy = [...prev];
              copy[idx] = { ...copy[idx]!, status: 'done', durationMs: ev.duration_ms };
              return copy;
            });
          } else if (ev.type === 'final') {
            patchAsst((t) => ({ ...t, text: t.text || ev.reply, streaming: false, usage: ev.usage }));
            setRunning(false);
          } else if (ev.type === 'error') {
            setError(ev.message);
            patchAsst((t) => ({ ...t, streaming: false }));
            setRunning(false);
          } else if (ev.type === 'model_blocked') {
            setError(`Modelo bloqueado pela policy: ${ev.reason}`);
            patchAsst((t) => ({ ...t, streaming: false }));
            setRunning(false);
          } else if (ev.type === 'budget_exceeded') {
            setError('Cap de custo atingido.');
            patchAsst((t) => ({ ...t, streaming: false }));
            setRunning(false);
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Falha no stream sandbox.');
      patchAsst((t) => ({ ...t, streaming: false }));
    } finally {
      setRunning(false);
    }
  }, []);

  return { turns, trace, running, error, send, reset };
}
