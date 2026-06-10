/**
 * Cliente HTTP tipado Node → `agent-runtime` (FastAPI + LangGraph, Python).
 *
 * `AGENTS_LANGGRAPH.md` §2, §8.1, §10. Usa o `fetch` global (Node >= 22) — sem
 * dependências de transporte. Auth via bearer token interno compartilhado
 * (`AGENT_RUNTIME_TOKEN` do lado Python; aqui injetado em `config.token`).
 *
 * Superfície pública:
 *   createAgentsClient({ baseUrl, token }) → {
 *     run(req): AsyncGenerator<AgentStreamEvent>   // SSE → eventos tipados (Zod)
 *     health(): Promise<HealthResponse>
 *     cancel(executionId): Promise<void>
 *   }
 *
 * Todo corpo externo passa por Zod no boundary (zero `any`). Falhas viram
 * `AgentRuntimeError` tipado.
 */

import { AgentRuntimeError } from './errors';
import { parseSseStream } from './sse';
import {
  AgentRunRequestSchema,
  AgentStreamEventSchema,
  HealthResponseSchema,
  type AgentRunRequest,
  type AgentStreamEvent,
  type HealthResponse,
} from './types';

export interface AgentsClientConfig {
  /** Base URL do runtime (ex.: `http://agent-runtime:8001`). Sem barra final obrigatória. */
  readonly baseUrl: string;
  /** Token interno compartilhado — enviado como `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Timeout por request não-stream (health/cancel) em ms. Default: 10000. */
  readonly requestTimeoutMs?: number;
  /**
   * Timeout para ABRIR o stream de `run` (TTFB) em ms. Default: 30000.
   * Não limita a duração do stream em si — só o handshake inicial.
   */
  readonly connectTimeoutMs?: number;
  /** Injeção de `fetch` (testes). Default: `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
}

export interface RunOptions {
  /** Aborta o stream a partir do chamador (ex.: cliente desconectou). */
  readonly signal?: AbortSignal;
}

const DEFAULTS = {
  requestTimeoutMs: 10_000,
  connectTimeoutMs: 30_000,
} as const;

const RUN_PATH = '/run';
const HEALTH_PATH = '/health';

export interface AgentsClient {
  /**
   * Dispara uma execução de agente e consome o stream SSE do runtime,
   * produzindo eventos tipados e validados por Zod. Lança `AgentRuntimeError`
   * se a abertura falha, se o transporte cai, ou se um frame não bate o contrato.
   */
  run(req: AgentRunRequest, opts?: RunOptions): AsyncGenerator<AgentStreamEvent, void, unknown>;
  /** Liveness do runtime (`GET /health`). */
  health(): Promise<HealthResponse>;
  /** Cancela uma execução em voo pelo seu `executionId` (thread_id). */
  cancel(executionId: string): Promise<void>;
}

export function createAgentsClient(config: AgentsClientConfig): AgentsClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? globalThis.fetch;
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
  const connectTimeoutMs = config.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;

  if (typeof doFetch !== 'function') {
    throw new AgentRuntimeError('global fetch unavailable; pass config.fetch', {
      kind: 'network',
    });
  }

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${config.token}`, ...extra };
  }

  function url(path: string): string {
    return `${baseUrl}${path}`;
  }

  /** fetch com timeout via AbortController, encadeado a um signal externo opcional. */
  async function fetchWithTimeout(
    target: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      return await doFetch(target, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'network error';
      throw AgentRuntimeError.network(reason, err);
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  async function* run(
    req: AgentRunRequest,
    opts?: RunOptions,
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    // Valida + normaliza o request no boundary de saída (defaults aplicados).
    const parsed = AgentRunRequestSchema.safeParse(req);
    if (!parsed.success) {
      throw AgentRuntimeError.contract(`invalid run request: ${parsed.error.message}`, parsed.error, req);
    }

    const res = await fetchWithTimeout(
      url(RUN_PATH),
      {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json', accept: 'text/event-stream' }),
        body: JSON.stringify(parsed.data),
      },
      connectTimeoutMs,
      opts?.signal,
    );

    if (!res.ok) {
      throw AgentRuntimeError.http(res.status, await safeBody(res));
    }
    if (!res.body) {
      throw AgentRuntimeError.stream('response has no body to stream');
    }

    for await (const frame of parseSseStream(res.body)) {
      yield parseEvent(frame);
    }
  }

  async function health(): Promise<HealthResponse> {
    const res = await fetchWithTimeout(
      url(HEALTH_PATH),
      { method: 'GET', headers: authHeaders() },
      requestTimeoutMs,
    );
    const body = await safeBody(res);
    if (!res.ok) {
      throw AgentRuntimeError.http(res.status, body);
    }
    const parsed = HealthResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw AgentRuntimeError.contract(`invalid health response: ${parsed.error.message}`, parsed.error, body);
    }
    return parsed.data;
  }

  async function cancel(executionId: string): Promise<void> {
    if (executionId.length === 0) {
      throw AgentRuntimeError.contract('cancel requires a non-empty executionId');
    }
    const res = await fetchWithTimeout(
      url(`${RUN_PATH}/${encodeURIComponent(executionId)}/cancel`),
      { method: 'POST', headers: authHeaders() },
      requestTimeoutMs,
    );
    // 200/202/204 = aceito; 404 = já terminou/não existe (idempotente, ok).
    if (!res.ok && res.status !== 404) {
      throw AgentRuntimeError.http(res.status, await safeBody(res));
    }
  }

  return { run, health, cancel };
}

/** Parseia um frame `data:` em `AgentStreamEvent` validado, ou lança tipado. */
function parseEvent(frame: string): AgentStreamEvent {
  let json: unknown;
  try {
    json = JSON.parse(frame) as unknown;
  } catch (err: unknown) {
    throw AgentRuntimeError.contract('SSE frame is not valid JSON', err, frame);
  }
  const parsed = AgentStreamEventSchema.safeParse(json);
  if (!parsed.success) {
    throw AgentRuntimeError.contract(`unknown stream event: ${parsed.error.message}`, parsed.error, json);
  }
  if (parsed.data.type === 'error') {
    throw AgentRuntimeError.runtime(parsed.data.message, parsed.data);
  }
  return parsed.data;
}

/** Lê o corpo como JSON; cai p/ texto cru se não-JSON (ex.: erro HTML/plain). */
async function safeBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
