/**
 * Contrato Node ↔ runtime do Copiloto (F73-S10).
 *
 * As fixtures são as EXPORTADAS pelo runtime Python (`apps/agent-runtime/tests/copilot/
 * fixtures/*.json`, F73-S04), lidas do disco: se o Python mudar o formato sem mudar o Zod
 * (ou o contrário), este teste quebra.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CopilotRunRequestSchema,
  CopilotRuntimeEventSchema,
  type CopilotRunRequest,
  type CopilotRuntimeEvent,
} from '@hm/shared/copilot';
import {
  COPILOT_RUN_PATH,
  createCopilotRuntimeClient,
  isTerminalCopilotEvent,
  parseCopilotRuntimeFrame,
} from './copilot';
import { AgentRuntimeError } from './errors';

const FIXTURES_DIR = fileURLToPath(
  new URL('../../../apps/agent-runtime/tests/copilot/fixtures/', import.meta.url),
);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${name}`, 'utf8')) as unknown;
}

const runRequest: CopilotRunRequest = CopilotRunRequestSchema.parse(readJson('run_request.json'));
const eventFixtures = readdirSync(FIXTURES_DIR).filter(
  (f) => f.startsWith('turn_events') && f.endsWith('.json'),
);

/** Mesmo formato do runtime (`sse_frame`: JSON compacto, `data: …\n\n`). */
function sse(events: readonly unknown[], extra = ''): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + extra;
}

/** Corpo em pedaços de tamanhos variados (corta linhas e caracteres multibyte no meio). */
function chunkedBody(
  text: string,
  sizes: readonly number[] = [1, 7, 3, 64, 2, 31],
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[i++ % sizes.length] ?? 16;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

interface Captured {
  url?: string;
  init?: RequestInit;
  calls: number;
}

function fakeFetch(
  body: string | (() => ReadableStream<Uint8Array>),
  status = 200,
): { fetch: typeof fetch; captured: Captured } {
  const captured: Captured = { calls: 0 };
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.calls++;
    captured.url = String(input);
    captured.init = init;
    const stream = typeof body === 'string' ? chunkedBody(body) : body();
    return new Response(stream, {
      status,
      headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' },
    });
  };
  return { fetch: impl as typeof fetch, captured };
}

async function collect(iter: AsyncIterable<CopilotRuntimeEvent>): Promise<CopilotRuntimeEvent[]> {
  const out: CopilotRuntimeEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

async function expectError(
  promise: Promise<unknown>,
  kind: AgentRuntimeError['kind'],
): Promise<AgentRuntimeError> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AgentRuntimeError);
  const typed = err as AgentRuntimeError;
  expect(typed.kind).toBe(kind);
  return typed;
}

describe('fixtures do runtime (F73-S04) contra o Zod do Node', () => {
  it('há fixtures de eventos para validar', () => {
    expect(eventFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it('run_request.json é um CopilotRunRequest válido', () => {
    expect(CopilotRunRequestSchema.safeParse(readJson('run_request.json')).success).toBe(true);
  });

  it.each(eventFixtures)(
    '%s: todo evento valida e o turno termina em exatamente um terminal',
    (name) => {
      const raw = readJson(name);
      expect(Array.isArray(raw)).toBe(true);
      const events = (raw as unknown[]).map((e) => CopilotRuntimeEventSchema.parse(e));
      const terminals = events.filter(isTerminalCopilotEvent);
      expect(terminals).toHaveLength(1);
      expect(isTerminalCopilotEvent(events[events.length - 1]!)).toBe(true);
    },
  );
});

describe('runCopilot', () => {
  it.each(eventFixtures)('%s: repassa os eventos do runtime em ordem, validados', async (name) => {
    const expected = (readJson(name) as unknown[]).map((e) => CopilotRuntimeEventSchema.parse(e));
    const { fetch, captured } = fakeFetch(sse(expected));
    const client = createCopilotRuntimeClient({
      baseUrl: 'http://runtime:8001/',
      token: 'tkn',
      fetch,
    });
    const got = await collect(client.runCopilot(runRequest));
    expect(got).toEqual(expected);

    expect(captured.url).toBe(`http://runtime:8001${COPILOT_RUN_PATH}`);
    expect(captured.init?.method).toBe('POST');
    const headers = new Headers(captured.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tkn');
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(JSON.parse(String(captured.init?.body))).toEqual(runRequest);
  });

  it('ignora comentários de heartbeat e para no terminal (o que vier depois não sai)', async () => {
    const events = (readJson('turn_events_timeout.json') as unknown[]).map((e) =>
      CopilotRuntimeEventSchema.parse(e),
    );
    const body = `: ping\n\n${sse(events)}data: ${JSON.stringify({ type: 'verdict_delta', text: 'depois' })}\n\n`;
    const { fetch } = fakeFetch(body);
    const got = await collect(
      createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch }).runCopilot(runRequest),
    );
    expect(got).toEqual(events);
  });

  it('error{code} do runtime é evento, não exceção', async () => {
    const { fetch } = fakeFetch(sse([{ type: 'error', code: 'model_error' }]));
    const got = await collect(
      createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch }).runCopilot(runRequest),
    );
    expect(got).toEqual([{ type: 'error', code: 'model_error' }]);
  });

  it('pedido fora do contrato → contract, sem tocar a rede', async () => {
    const { fetch, captured } = fakeFetch(sse([]));
    const client = createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch });
    const bad = { ...runRequest, member_id: 'x' } as unknown as CopilotRunRequest;
    await expectError(collect(client.runCopilot(bad)), 'contract');
    const tooManyHistory = {
      ...runRequest,
      history: Array.from({ length: 13 }, () => ({ role: 'user' as const, content: 'a' })),
    };
    await expectError(collect(client.runCopilot(tooManyHistory)), 'contract');
    expect(captured.calls).toBe(0);
  });

  it('frame fora do contrato → contract (campo extra, tipo desconhecido, JSON inválido)', async () => {
    for (const frame of [
      { type: 'status', tool_key: 'list_deals', label: 'texto do modelo' },
      { type: 'tool_result', result_id: 'r1' },
      'nao-e-json',
    ]) {
      const body = typeof frame === 'string' ? `data: ${frame}\n\n` : sse([frame]);
      const { fetch } = fakeFetch(body);
      const err = await expectError(
        collect(
          createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch }).runCopilot(
            runRequest,
          ),
        ),
        'contract',
      );
      // O erro não carrega o frame cru (pode ter dado de negócio).
      expect(err.raw).toBeUndefined();
    }
  });

  it('stream que acaba sem final/error → stream', async () => {
    const { fetch } = fakeFetch(sse([{ type: 'status', tool_key: 'list_deals' }]));
    await expectError(
      collect(
        createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch }).runCopilot(
          runRequest,
        ),
      ),
      'stream',
    );
  });

  it('HTTP não-2xx → http com status e sem o corpo do runtime', async () => {
    const { fetch } = fakeFetch(JSON.stringify({ detail: [{ input: 'dado do pedido' }] }), 422);
    const err = await expectError(
      collect(
        createCopilotRuntimeClient({ baseUrl: 'http://r', token: 't', fetch }).runCopilot(
          runRequest,
        ),
      ),
      'http',
    );
    expect(err.httpStatus).toBe(422);
    expect(err.raw).toBeUndefined();
    expect(err.message).not.toContain('dado do pedido');
  });

  it('parseCopilotRuntimeFrame valida um frame isolado', () => {
    expect(parseCopilotRuntimeFrame('{"type":"iteration_exceeded"}')).toEqual({
      type: 'iteration_exceeded',
    });
    expect(() => parseCopilotRuntimeFrame('{"type":"iteration_exceeded","x":1}')).toThrow(
      AgentRuntimeError,
    );
  });
});

describe('runCopilot contra um servidor HTTP real', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it('abortar o sinal fecha a conexão com o runtime (o grafo é cancelado do lado Python)', async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    const baseUrl = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(sse([{ type: 'status', tool_key: 'list_deals' }]));
      // Nunca termina: só o abort do Node encerra.
      res.on('close', () => upstreamClosed());
    });
    const controller = new AbortController();
    const client = createCopilotRuntimeClient({ baseUrl, token: 't' });
    const seen: CopilotRuntimeEvent[] = [];
    const run = (async () => {
      for await (const ev of client.runCopilot(runRequest, { signal: controller.signal })) {
        seen.push(ev);
        controller.abort();
      }
    })();
    await expectError(run, 'network');
    await closed;
    expect(seen).toEqual([{ type: 'status', tool_key: 'list_deals' }]);
  });

  it('runtime fora do ar → network', async () => {
    const baseUrl = await listen((_req, res) => res.end());
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    await expectError(
      collect(createCopilotRuntimeClient({ baseUrl, token: 't' }).runCopilot(runRequest)),
      'network',
    );
  });
});
