/**
 * Cliente Node → `agent-runtime` para o Copiloto (F73-S10; COPILOTO.md §5.4).
 *
 *   POST {RUNTIME}/copilot/run   (Bearer AGENT_RUNTIME_TOKEN, corpo `CopilotRunRequest`)
 *   ← text/event-stream, um frame `data: <json>\n\n` por evento interno
 *
 * Contrato: o Zod de `@hm/shared/copilot` (`internal.ts`) é a fonte; o runtime Python o
 * espelha em pydantic. Este módulo valida o pedido ANTES de sair e cada frame que chega:
 * frame fora do contrato é `AgentRuntimeError` de `contract`, nunca repassado.
 *
 * Diferenças deliberadas em relação ao `run` dos agentes (`client.ts`):
 * - `error{code}` do runtime é um EVENTO, não uma exceção: é um desfecho previsto do turno
 *   (`timeout`, `model_error`), e quem chama o mapeia para o contrato público. Exceção fica
 *   para o que é falha de transporte ou de contrato.
 * - O turno termina em exatamente um `final` ou um `error` (garantia do runtime). O iterador
 *   para no terminal e, se o stream acabar sem nenhum, lança `stream`: um turno sem desfecho
 *   não pode parecer bem-sucedido.
 */
import {
  CopilotRunRequestSchema,
  CopilotRuntimeEventSchema,
  type CopilotRunRequest,
  type CopilotRuntimeEvent,
} from '@hm/shared/copilot';
import { AgentRuntimeError } from './errors';
import { parseSseStream } from './sse';

export const COPILOT_RUN_PATH = '/copilot/run';

export interface CopilotRuntimeClientConfig {
  /** Base URL do runtime (ex.: `http://agent-runtime:8001`). Barra final opcional. */
  readonly baseUrl: string;
  /** `AGENT_RUNTIME_TOKEN`, enviado como `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Tempo para o runtime RESPONDER (cabeçalhos) em ms. Não limita o stream. Default 10000. */
  readonly connectTimeoutMs?: number;
  /** Injeção de `fetch` (testes). Default: `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
}

export interface RunCopilotOptions {
  /** Aborta o turno (cliente desconectou, cancelou, ou o teto de tempo do Node venceu). */
  readonly signal?: AbortSignal;
}

export interface CopilotRuntimeClient {
  /**
   * Abre o turno e itera os eventos internos validados. Para no primeiro evento terminal
   * (`final` ou `error`). Lança `AgentRuntimeError` em pedido inválido (`contract`, sem
   * chamar a rede), HTTP não-2xx (`http`), rede/abort (`network`), frame fora do contrato
   * (`contract`) ou stream sem desfecho (`stream`).
   */
  runCopilot(
    request: CopilotRunRequest,
    options?: RunCopilotOptions,
  ): AsyncGenerator<CopilotRuntimeEvent, void, unknown>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Evento terminal do turno: depois dele o runtime não emite mais nada. */
export function isTerminalCopilotEvent(event: CopilotRuntimeEvent): boolean {
  return event.type === 'final' || event.type === 'error';
}

/** Valida um frame `data:` cru contra o contrato interno. Lança `contract`. */
export function parseCopilotRuntimeFrame(frame: string): CopilotRuntimeEvent {
  let json: unknown;
  try {
    json = JSON.parse(frame) as unknown;
  } catch (err: unknown) {
    throw AgentRuntimeError.contract('copilot frame is not valid JSON', err);
  }
  const parsed = CopilotRuntimeEventSchema.safeParse(json);
  if (!parsed.success) {
    // Sem o frame cru no erro: ele pode carregar dado de negócio (cartões, veredito).
    throw AgentRuntimeError.contract(
      `copilot frame outside the contract (${parsed.error.issues.length} issue(s))`,
      parsed.error,
    );
  }
  return parsed.data;
}

export function createCopilotRuntimeClient(
  config: CopilotRuntimeClientConfig,
): CopilotRuntimeClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const doFetch = config.fetch ?? globalThis.fetch;
  const connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  if (typeof doFetch !== 'function') {
    throw new AgentRuntimeError('global fetch unavailable; pass config.fetch', { kind: 'network' });
  }

  async function open(body: string, signal: AbortSignal | undefined): Promise<Response> {
    // Um controller por chamada: o timeout de conexão e o sinal externo abortam o MESMO fetch,
    // e o sinal externo continua valendo durante a leitura do corpo (o fetch o propaga).
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error(`connect timeout after ${connectTimeoutMs}ms`)),
      connectTimeoutMs,
    );
    try {
      return await doFetch(`${baseUrl}${COPILOT_RUN_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      throw AgentRuntimeError.network(err instanceof Error ? err.message : 'network error', err);
    } finally {
      clearTimeout(timer);
    }
  }

  async function* runCopilot(
    request: CopilotRunRequest,
    options: RunCopilotOptions = {},
  ): AsyncGenerator<CopilotRuntimeEvent, void, unknown> {
    const parsed = CopilotRunRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw AgentRuntimeError.contract(
        `invalid copilot run request (${parsed.error.issues.length} issue(s))`,
        parsed.error,
      );
    }

    const res = await open(JSON.stringify(parsed.data), options.signal);
    if (!res.ok) {
      // O corpo de erro do runtime não sobe: pode ecoar o pedido (pydantic 422).
      await res.body?.cancel().catch(() => undefined);
      throw AgentRuntimeError.http(res.status, undefined);
    }
    if (!res.body) throw AgentRuntimeError.stream('response has no body to stream');

    let terminal = false;
    try {
      for await (const frame of parseSseStream(res.body)) {
        const event = parseCopilotRuntimeFrame(frame);
        yield event;
        if (isTerminalCopilotEvent(event)) {
          terminal = true;
          return;
        }
      }
    } catch (err: unknown) {
      if (
        options.signal?.aborted &&
        !(err instanceof AgentRuntimeError && err.kind === 'contract')
      ) {
        throw AgentRuntimeError.network('aborted by caller', err);
      }
      throw err;
    } finally {
      // Saída antecipada (terminal, `break` do chamador, erro): fecha a conexão com o runtime,
      // que cancela o grafo do lado Python (nada continua gastando).
      await res.body.cancel().catch(() => undefined);
    }
    if (!terminal) {
      if (options.signal?.aborted) throw AgentRuntimeError.network('aborted by caller');
      throw AgentRuntimeError.stream('copilot stream ended without a terminal event');
    }
  }

  return { runCopilot };
}
