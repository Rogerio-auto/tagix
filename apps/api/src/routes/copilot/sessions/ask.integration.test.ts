/**
 * F73-S10 — pergunta → SSE de produção, contra o Postgres e o Redis de dev, com um runtime
 * FALSO de verdade (servidor HTTP local que fala o contrato interno, `/copilot/run`).
 *
 * O runtime falso chama o callback REAL das ferramentas (`/internal/copilot/tools/:key`) com
 * o grant que recebeu: o `tool_result` que chega ao navegador é o envelope que o próprio Node
 * gerou, e a recusa de escrita em `queries_only` é do motor de propostas (F73-S05) atrás do
 * callback real (proposta `blocked`), não do teste. O executor é FAKE (sem domínio).
 *
 * Todo frame recebido passa pelo `CopilotStreamEventSchema` (o leitor faz `parse`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCopilotRuntimeClient } from '@hm/agents-client';
import { monthToDateSpendUsd, resolvePolicy } from '@hm/agents-core';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import type { LogFields, Logger } from '@hm/logger';
import {
  CopilotRunRequestSchema,
  CopilotRuntimeEventSchema,
  CopilotStreamEventSchema,
  CopilotToolEnvelopeSchema,
  type CopilotRunRequest,
  type CopilotRuntimeEvent,
  type CopilotStreamEvent,
  type CopilotToolEnvelope,
} from '@hm/shared';
import { defineCopilotTool } from '../../../internal/copilot/core/registry';
import { makeProposeTool } from '../../../services/copilot/proposals/propose';
import {
  FakeStore,
  fakeDealMoveExecutor,
  makeTestDeps,
} from '../../../services/copilot/proposals/test-fixtures';
import { createCopilotToolsRouter } from '../../../internal/copilot/core/router';
import { requireAuth, withRLS } from '../../../middlewares/auth';
import { copilotAvailable } from '../../../services/copilot/identity/available';
import {
  seedCopilotWorkspace,
  type SeededMember,
  type SeededWorkspace,
} from '../../../services/copilot/identity/test-fixtures';
import {
  COPILOT_RATE_LIMITS,
  createRedisCopilotRateLimiter,
  type CopilotRateLimiter,
} from '../../../services/copilot/turns/rate-limit';
import type { CopilotTurnDeps } from '../../../services/copilot/turns/run';
import { createCopilotSessionsRouter } from './index';

// ─── Ferramentas de teste (o mesmo registro alimenta descritores e callback) ─────

const TOKEN = `test-${randomUUID()}`;
const GRANT_SECRET = randomBytes(32);
/** Registros do executor fake: `executeCalls` vazio = nenhuma escrita aconteceu. */
const store = new FakeStore();
const engineDeps = makeTestDeps(store);

const tools = [
  defineCopilotTool({
    key: 'test_list_deals',
    capability: 'query',
    area: 'pipeline',
    description: 'Lista negócios (teste).',
    args: z.object({}).strict(),
    requires: ['pipeline.view'],
    taintsTurn: false,
    async handler(ctx) {
      const emitted = ctx.emitResult({
        kind: 'kpis',
        source: { label: 'Pipeline', as_of: new Date().toISOString(), record_count: 3 },
        truncated: false,
        data: {
          currency: 'BRL',
          items: [
            {
              key: 'open',
              label: 'Em aberto',
              value: 3,
              format: 'number',
              delta: null,
              range: null,
            },
          ],
          why: [],
        },
      });
      return { ok: true, decision: 'executed', model_view: { open: 3 }, ...emitted };
    },
  }),
  // Escrita: só pelo motor de propostas (`makeProposeTool`), como em produção.
  makeProposeTool(fakeDealMoveExecutor(store), {
    description: 'Propõe mover negócios (teste).',
    deps: () => engineDeps,
  }),
];
const MOVE_KEY = 'propose_deal_move';

// ─── Logger que captura (a métrica do turno é conferida) ─────────────────────────

const logLines: { level: string; msg: string; fields: LogFields }[] = [];
function captureLogger(): Logger {
  const push =
    (level: string) =>
    (msg: string, fields: LogFields = {}) => {
      logLines.push({ level, msg, fields });
    };
  const logger: Logger = {
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    child: () => logger,
  };
  return logger;
}

// ─── Runtime falso ───────────────────────────────────────────────────────────────

interface RuntimeRun {
  readonly body: CopilotRunRequest;
  send(event: CopilotRuntimeEvent): void;
  /** Resolve quando o Node fecha a conexão (abort). */
  readonly closed: Promise<void>;
  callTool(key: string, args: Record<string, unknown>): Promise<CopilotToolEnvelope>;
}
type Script = (run: RuntimeRun) => Promise<void>;

const runtimeCalls: CopilotRunRequest[] = [];
let script: Script;
let runtimeStatus = 200;

const answer = (
  over: Partial<{ verdict: string; data_refs: string[] }> = {},
  cost: number | null = 0.0002,
): CopilotRuntimeEvent => ({
  type: 'final',
  blocks: { verdict: 'Tudo certo.', why: [], data_refs: [], sources: [], next_steps: [], ...over },
  usage: { prompt_tokens: 120, completion_tokens: 30, total_cost_usd: cost },
  iterations: 1,
});
const quickFinal: Script = async (run) => {
  run.send({ type: 'verdict_delta', text: 'Tudo certo.' });
  run.send(answer());
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

let apiUrl = '';
let runtimeUrl = '';
let apiServer: Server;
let runtimeServer: Server;

function startRuntime(): Promise<void> {
  runtimeServer = createServer((req, res) => {
    void (async () => {
      if (req.url !== '/copilot/run' || req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const body = CopilotRunRequestSchema.parse(JSON.parse(await readBody(req)));
      runtimeCalls.push(body);
      if (runtimeStatus !== 200) {
        res
          .writeHead(runtimeStatus, { 'content-type': 'application/json' })
          .end('{"detail":"boom"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const closed = new Promise<void>((resolve) => res.on('close', () => resolve()));
      const run: RuntimeRun = {
        body,
        closed,
        send(event) {
          if (!res.writableEnded && !res.destroyed) {
            res.write(`data: ${JSON.stringify(CopilotRuntimeEventSchema.parse(event))}\n\n`);
          }
        },
        async callTool(key, args) {
          const r = await fetch(`${apiUrl}/internal/copilot/tools/${key}`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${TOKEN}`,
              'x-copilot-grant': body.grant,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ turn_id: body.turn_id, call_id: randomUUID(), args }),
          });
          return CopilotToolEnvelopeSchema.parse(await r.json());
        },
      };
      try {
        await script(run);
      } finally {
        if (!res.writableEnded) res.end();
      }
    })();
  });
  return new Promise((resolve) => runtimeServer.listen(0, '127.0.0.1', () => resolve()));
}

// ─── Leitor SSE do teste ─────────────────────────────────────────────────────────

interface AskResult {
  readonly status: number;
  readonly headers: Headers;
  readonly frames: CopilotStreamEvent[];
  readonly comments: string[];
  readonly firstFrameMs: number | null;
  readonly json: unknown;
}

async function ask(
  member: SeededMember,
  sessionId: string,
  body: Record<string, unknown>,
  onFrame?: (frame: CopilotStreamEvent, abort: () => void) => void,
  baseUrl: string = apiUrl,
): Promise<AskResult> {
  const controller = new AbortController();
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/copilot/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { cookie: member.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ origin: 'bubble', client_request_id: randomUUID(), ...body }),
    signal: controller.signal,
  });
  if (!(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
    return {
      status: res.status,
      headers: res.headers,
      frames: [],
      comments: [],
      firstFrameMs: null,
      json: await res.json(),
    };
  }
  const frames: CopilotStreamEvent[] = [];
  const comments: string[] = [];
  let firstFrameMs: number | null = null;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) comments.push(line);
          else if (line.startsWith('data: ')) {
            // DoD: TODO frame emitido valida no contrato público.
            const frame = CopilotStreamEventSchema.parse(JSON.parse(line.slice(6)));
            firstFrameMs ??= performance.now() - t0;
            frames.push(frame);
            onFrame?.(frame, () => controller.abort());
          }
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } catch (err: unknown) {
    if (!(err instanceof Error && err.name === 'AbortError')) throw err;
  }
  return { status: res.status, headers: res.headers, frames, comments, firstFrameMs, json: null };
}

async function createSession(member: SeededMember): Promise<string> {
  const res = await fetch(`${apiUrl}/api/copilot/sessions`, {
    method: 'POST',
    headers: { cookie: member.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ origin: 'bubble' }),
  });
  expect(res.status).toBe(201);
  const json = z
    .object({ id: z.string().uuid() })
    .passthrough()
    .parse(await res.json());
  return json.id;
}

async function turnRow(workspaceId: string, turnId: string) {
  return withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.copilotTurns)
      .where(eq(schema.copilotTurns.id, turnId));
    return row ?? null;
  });
}

/** Espera o servidor encerrar o turno (o stream do cliente já pode ter fechado antes). */
async function waitTurnEnded(workspaceId: string, turnId: string) {
  for (let i = 0; i < 100; i++) {
    const row = await turnRow(workspaceId, turnId);
    if (row && row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('turno não encerrou');
}

function startedTurnId(result: AskResult): string {
  const first = result.frames[0];
  if (!first || first.type !== 'turn_started') throw new Error('sem turn_started');
  return first.turn_id;
}

// ─── Montagem ────────────────────────────────────────────────────────────────────

function turnDeps(over: Partial<CopilotTurnDeps> = {}): Partial<CopilotTurnDeps> {
  return {
    runtime: () => createCopilotRuntimeClient({ baseUrl: runtimeUrl, token: TOKEN }),
    rateLimiter: { consume: (memberId, now) => activeLimiter.consume(memberId, now) },
    tools,
    logger: captureLogger(),
    heartbeatMs: 100,
    defaultModel: testModel,
    grantSecret: GRANT_SECRET,
    ...over,
  };
}

async function listen(app: express.Express): Promise<Server> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return server;
}

let main: SeededWorkspace;
let budgetWs: SeededWorkspace;
let readOnlyWs: SeededWorkspace;
let other: SeededWorkspace;
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const rlPrefix = `test:copilot:ask:${randomUUID()}`;
const permissive = createRedisCopilotRateLimiter({
  redis,
  keyPrefix: `${rlPrefix}:p`,
  limits: { perMinute: 10_000, perDay: 100_000 },
});
let activeLimiter: CopilotRateLimiter = permissive;
const testModel = `test/copilot-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  [main, budgetWs, readOnlyWs, other] = await Promise.all([
    seedCopilotWorkspace({ label: 'Ask' }),
    seedCopilotWorkspace({ label: 'Ask budget' }),
    seedCopilotWorkspace({ label: 'Ask read-only', subscriptionStatus: 'expired' }),
    seedCopilotWorkspace({ label: 'Ask other' }),
  ]);
  await startRuntime();
  runtimeUrl = `http://127.0.0.1:${(runtimeServer.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json());
  app.use(
    createCopilotToolsRouter({
      tools,
      token: TOKEN,
      grantSecret: GRANT_SECRET,
      logger: captureLogger(),
    }),
  );
  app.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
  app.use(createCopilotSessionsRouter({ turnDeps: turnDeps() }));
  apiServer = await listen(app);
  apiUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  apiServer?.closeAllConnections();
  runtimeServer?.closeAllConnections();
  await new Promise<void>((r) => (apiServer ? apiServer.close(() => r()) : r()));
  await new Promise<void>((r) => (runtimeServer ? runtimeServer.close(() => r()) : r()));
  await getDb()
    .delete(schema.llmModelsWhitelist)
    .where(eq(schema.llmModelsWhitelist.slug, testModel));
  await Promise.all([
    main?.cleanup(),
    budgetWs?.cleanup(),
    readOnlyWs?.cleanup(),
    other?.cleanup(),
  ]);
  const keys = await redis.keys(`${rlPrefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
  await closeDb();
});

beforeEach(() => {
  script = quickFinal;
  runtimeStatus = 200;
  activeLimiter = permissive;
  store.executeCalls.length = 0;
});

// ─── Testes ──────────────────────────────────────────────────────────────────────

describe('POST /api/copilot/sessions/:id/messages (SSE)', () => {
  it('sequência pública, tool_result do envelope do Node, data_refs inventado removido e tudo gravado', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    let envelope: CopilotToolEnvelope | null = null;
    script = async (run) => {
      run.send({ type: 'status', tool_key: 'test_list_deals' });
      envelope = await run.callTool('test_list_deals', {});
      run.send({
        type: 'tool_call_completed',
        tool_key: 'test_list_deals',
        call_id: 'c1',
        envelope,
      });
      run.send({ type: 'verdict_delta', text: 'Há 3 negócios ' });
      run.send({ type: 'verdict_delta', text: 'em aberto.' });
      run.send(
        answer({
          verdict: 'Há 3 negócios em aberto.',
          data_refs: [envelope.result_id ?? 'x', 'r-inventado'],
        }),
      );
    };
    const result = await ask(owner, sessionId, {
      text: 'Quantos negócios estão em aberto no funil hoje?',
    });

    expect(result.status).toBe(200);
    expect(result.frames.map((f) => f.type)).toEqual([
      'turn_started',
      'status',
      'tool_result',
      'verdict_delta',
      'verdict_delta',
      'final',
    ]);
    expect(result.frames[1]).toEqual({
      v: 1,
      type: 'status',
      phase: 'reading',
      label: expect.any(String),
    });
    // O cartão é EXATAMENTE o `public_event` que o callback do Node devolveu.
    const env = envelope as CopilotToolEnvelope | null;
    expect(env?.decision).toBe('executed');
    expect(result.frames[2]).toEqual(env?.public_event);
    const final = result.frames[5];
    if (final?.type !== 'final') throw new Error('sem final');
    expect(final.blocks.data_refs).toEqual([env?.result_id]);

    const turnId = startedTurnId(result);
    const turn = await turnRow(main.workspaceId, turnId);
    expect(turn).toMatchObject({
      status: 'completed',
      promptTokens: 120,
      completionTokens: 30,
      iterations: 1,
      toolCalls: 1,
      model: testModel,
    });
    expect(Number(turn?.costUsd)).toBeCloseTo(0.0002, 8);

    await withWorkspace(main.workspaceId, async (tx) => {
      const msgs = await tx
        .select()
        .from(schema.copilotMessages)
        .where(eq(schema.copilotMessages.sessionId, sessionId))
        .orderBy(schema.copilotMessages.createdAt);
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(msgs[0]?.id).toBe(
        result.frames[0]?.type === 'turn_started' ? result.frames[0].message_id : '',
      );
      expect(msgs[1]).toMatchObject({
        id: final.message_id,
        content: 'Há 3 negócios em aberto.',
        turnId,
      });
      expect(msgs[1]?.toolResults).toHaveLength(1);
      const usage = await tx
        .select()
        .from(schema.llmUsageLogs)
        .where(eq(schema.llmUsageLogs.copilotTurnId, turnId));
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({
        surface: 'copilot',
        model: testModel,
        promptTokens: 120,
        completionTokens: 30,
      });
      expect(Number(usage[0]?.costUsd)).toBeCloseTo(0.0002, 8);
      const [session] = await tx
        .select()
        .from(schema.copilotSessions)
        .where(eq(schema.copilotSessions.id, sessionId));
      expect(session?.title).toBe('Quantos negócios estão em aberto no funil hoje?');
    });

    // Pedido ao runtime: sem identidade; ferramentas do membro; primeira pergunta sem histórico.
    const sent = runtimeCalls[runtimeCalls.length - 1];
    expect(sent?.history).toEqual([]);
    expect(sent?.tools.map((t) => t.key).sort()).toEqual([MOVE_KEY, 'test_list_deals'].sort());
    expect(sent?.policy).toMatchObject({
      model: testModel,
      max_iterations: 8,
      max_tool_calls: 16,
      turn_timeout_s: 60,
    });
    expect(JSON.stringify(sent)).not.toContain(owner.id);

    // Segunda pergunta na mesma sessão: o histórico leva pergunta + veredito.
    await ask(owner, sessionId, { text: 'E ontem?' });
    expect(runtimeCalls[runtimeCalls.length - 1]?.history).toEqual([
      { role: 'user', content: 'Quantos negócios estão em aberto no funil hoje?' },
      { role: 'assistant', content: 'Há 3 negócios em aberto.' },
    ]);

    // Métrica do turno no log, sem conteúdo.
    const metric = logLines.find((l) => l.msg === 'copilot.turn' && l.fields['turn_id'] === turnId);
    expect(metric?.fields).toMatchObject({
      outcome: 'final',
      tool_calls: 1,
      tainted: false,
      iterations: 1,
      model: testModel,
    });
    expect(typeof metric?.fields['duration_ms']).toBe('number');
    expect(JSON.stringify(metric)).not.toContain('negócios');
  });

  it('cabeçalhos de streaming, turn_started rápido e heartbeat de comentário', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    script = async (run) => {
      await new Promise((r) => setTimeout(r, 450));
      run.send(answer());
    };
    const result = await ask(owner, sessionId, { text: 'Oi' });
    expect(result.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(result.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(result.headers.get('x-accel-buffering')).toBe('no');
    expect(result.frames[0]?.type).toBe('turn_started');
    expect(result.firstFrameMs).not.toBeNull();
    expect(result.firstFrameMs ?? Infinity).toBeLessThan(800);
    expect(result.comments.length).toBeGreaterThanOrEqual(2);
    expect(result.frames[result.frames.length - 1]?.type).toBe('final');
  });

  it('desconexão do cliente aborta o runtime e grava cancelled com a pergunta e o parcial', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    let runtimeClosed: Promise<void> = Promise.resolve();
    script = async (run) => {
      runtimeClosed = run.closed;
      run.send({ type: 'verdict_delta', text: 'Parcial' });
      await run.closed;
    };
    let turnId = '';
    const result = await ask(owner, sessionId, { text: 'Pergunta longa' }, (frame, abort) => {
      if (frame.type === 'turn_started') turnId = frame.turn_id;
      if (frame.type === 'verdict_delta') abort();
    });
    expect(result.frames.map((f) => f.type)).toEqual(['turn_started', 'verdict_delta']);
    await runtimeClosed;
    const turn = await waitTurnEnded(main.workspaceId, turnId);
    expect(turn).toMatchObject({ status: 'cancelled', errorCode: 'client_disconnected' });
    const msgs = await withWorkspace(main.workspaceId, (tx) =>
      tx.select().from(schema.copilotMessages).where(eq(schema.copilotMessages.turnId, turnId)),
    );
    expect(msgs.map((m) => [m.role, m.content]).sort()).toEqual([
      ['assistant', 'Parcial'],
      ['user', 'Pergunta longa'],
    ]);
  });

  it('um turno por membro: outro pedido → turn_in_progress; o mesmo client_request_id → 409', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    script = async (run) => {
      await gate;
      run.send(answer());
    };
    const clientRequestId = randomUUID();
    let started!: () => void;
    const firstStarted = new Promise<void>((r) => (started = r));
    const first = ask(
      owner,
      sessionId,
      { text: 'Primeira', client_request_id: clientRequestId },
      (f) => {
        if (f.type === 'turn_started') started();
      },
    );
    await firstStarted;

    const second = await ask(owner, sessionId, { text: 'Segunda' });
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0]).toMatchObject({
      v: 1,
      type: 'error',
      code: 'turn_in_progress',
      ref: expect.stringMatching(/^hm_err_/),
    });

    const replay = await ask(owner, sessionId, {
      text: 'Primeira',
      client_request_id: clientRequestId,
    });
    expect(replay.status).toBe(409);
    expect(replay.json).toMatchObject({ error: 'duplicate_request', turn_id: expect.any(String) });

    release();
    const done = await first;
    expect(done.frames[done.frames.length - 1]?.type).toBe('final');
    expect((replay.json as { turn_id: string }).turn_id).toBe(startedTurnId(done));
  });

  it('reenvio com o mesmo client_request_id depois de concluído → 409 com o turn_id, sem chamar o runtime', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    const clientRequestId = randomUUID();
    const first = await ask(owner, sessionId, {
      text: 'Uma vez',
      client_request_id: clientRequestId,
    });
    const calls = runtimeCalls.length;
    const again = await ask(owner, sessionId, {
      text: 'Uma vez',
      client_request_id: clientRequestId,
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: 'duplicate_request', turn_id: startedTurnId(first) });
    expect(runtimeCalls.length).toBe(calls);
  });

  it('7º pedido no minuto → rate_limited', async () => {
    activeLimiter = createRedisCopilotRateLimiter({ redis, keyPrefix: `${rlPrefix}:strict` });
    const member = main.members.SUPERVISOR;
    const sessionId = await createSession(member);
    for (let i = 0; i < COPILOT_RATE_LIMITS.perMinute; i++) {
      const ok = await ask(member, sessionId, { text: `Pergunta ${i}` });
      expect(ok.frames[ok.frames.length - 1]?.type).toBe('final');
    }
    const calls = runtimeCalls.length;
    const seventh = await ask(member, sessionId, { text: 'Sétima' });
    expect(seventh.frames).toEqual([
      { v: 1, type: 'error', code: 'rate_limited', ref: expect.stringMatching(/^hm_err_/) },
    ]);
    expect(seventh.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(runtimeCalls.length).toBe(calls);
  });

  it('runtime: error{code} → frame error seguro e turno failed; HTTP 500 → runtime_unavailable', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    script = async (run) => {
      run.send({ type: 'verdict_delta', text: 'Parc' });
      run.send({ type: 'error', code: 'provider_error' });
    };
    const failed = await ask(owner, sessionId, { text: 'Falha' });
    const last = failed.frames[failed.frames.length - 1];
    expect(last).toMatchObject({ type: 'error', code: 'runtime_unavailable' });
    const turn = await turnRow(main.workspaceId, startedTurnId(failed));
    expect(turn).toMatchObject({ status: 'failed', errorCode: 'provider_error' });
    const ref = last?.type === 'error' ? last.ref : '';
    expect(logLines.some((l) => l.fields['ref'] === ref && l.msg === 'copilot.turn_failed')).toBe(
      true,
    );

    runtimeStatus = 500;
    const down = await ask(owner, sessionId, { text: 'Fora' });
    expect(down.frames.map((f) => f.type)).toEqual(['turn_started', 'error']);
    expect(down.frames[1]).toMatchObject({ code: 'runtime_unavailable' });
    expect(JSON.stringify(down.frames)).not.toContain('boom');
  });

  it('"Parar" (POST /turns/:id/cancel) do dono aborta e grava cancelled; de outro membro → 404', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    let runtimeClosed: Promise<void> = Promise.resolve();
    script = async (run) => {
      runtimeClosed = run.closed;
      run.send({ type: 'verdict_delta', text: 'Começando' });
      await run.closed;
    };
    let turnId = '';
    let cancelStatus: Promise<number[]> = Promise.resolve([]);
    const result = await ask(owner, sessionId, { text: 'Demorada' }, (frame) => {
      if (frame.type === 'turn_started') turnId = frame.turn_id;
      if (frame.type === 'verdict_delta') {
        cancelStatus = (async () => {
          const intruder = await fetch(`${apiUrl}/api/copilot/turns/${turnId}/cancel`, {
            method: 'POST',
            headers: { cookie: main.members.ADMIN.cookie },
          });
          const mine = await fetch(`${apiUrl}/api/copilot/turns/${turnId}/cancel`, {
            method: 'POST',
            headers: { cookie: owner.cookie },
          });
          return [intruder.status, mine.status];
        })();
      }
    });
    expect(await cancelStatus).toEqual([404, 200]);
    await runtimeClosed;
    expect(result.frames.map((f) => f.type)).toEqual(['turn_started', 'verdict_delta']);
    const turn = await waitTurnEnded(main.workspaceId, turnId);
    expect(turn).toMatchObject({ status: 'cancelled', errorCode: 'cancelled_by_user' });
  });

  it('teto de tempo do Node: runtime mudo → error timeout e turno failed', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
    app.use(createCopilotSessionsRouter({ turnDeps: turnDeps({ deadlineMs: 300 }) }));
    const server = await listen(app);
    try {
      const owner = main.members.OWNER;
      const sessionId = await createSession(owner);
      let runtimeClosed: Promise<void> = Promise.resolve();
      script = async (run) => {
        runtimeClosed = run.closed;
        await run.closed;
      };
      const result = await ask(
        owner,
        sessionId,
        { text: 'Mudo' },
        undefined,
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      expect(result.frames.map((f) => f.type)).toEqual(['turn_started', 'error']);
      expect(result.frames[1]).toMatchObject({ code: 'timeout' });
      await runtimeClosed;
      expect(await turnRow(main.workspaceId, startedTurnId(result))).toMatchObject({
        status: 'failed',
        errorCode: 'timeout',
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('runtime não configurado → runtime_unavailable sem criar turno', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/copilot', requireAuth, withRLS, copilotAvailable);
    app.use(createCopilotSessionsRouter({ turnDeps: turnDeps({ runtime: () => null }) }));
    const server = await listen(app);
    try {
      const owner = main.members.OWNER;
      const sessionId = await createSession(owner);
      const result = await ask(
        owner,
        sessionId,
        { text: 'Oi' },
        undefined,
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      expect(result.frames).toEqual([
        {
          v: 1,
          type: 'error',
          code: 'runtime_unavailable',
          ref: expect.stringMatching(/^hm_err_/),
        },
      ]);
      const turns = await withWorkspace(main.workspaceId, (tx) =>
        tx.select().from(schema.copilotTurns).where(eq(schema.copilotTurns.sessionId, sessionId)),
      );
      expect(turns).toHaveLength(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('custo nulo do provedor → calculado pelo preço da whitelist', async () => {
    await getDb()
      .insert(schema.llmModelsWhitelist)
      .values({
        slug: testModel,
        displayName: 'Modelo de teste',
        upstreamProvider: 'openai',
        pricingPromptPer1m: '1.000000',
        pricingCompletionPer1m: '2.000000',
      })
      .onConflictDoNothing();
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    script = async (run) => run.send(answer({}, null));
    const result = await ask(owner, sessionId, { text: 'Custo?' });
    const turnId = startedTurnId(result);
    const [usage] = await withWorkspace(main.workspaceId, (tx) =>
      tx.select().from(schema.llmUsageLogs).where(eq(schema.llmUsageLogs.copilotTurnId, turnId)),
    );
    // 120 × 1/1M + 30 × 2/1M
    expect(Number(usage?.costUsd)).toBeCloseTo(0.00018, 8);
    expect(usage?.metadata).toMatchObject({ cost_source: 'whitelist_pricing' });
    await getDb()
      .delete(schema.llmModelsWhitelist)
      .where(eq(schema.llmModelsWhitelist.slug, testModel));
  });
});

describe('contexto de página', () => {
  let visiblePipeline = '';
  let foreignPipeline = '';
  let foreignDeal = '';
  let othersDeal = '';

  beforeAll(async () => {
    const db = getDb();
    const mk = async (ws: SeededWorkspace, name: string) => {
      const [p] = await db
        .insert(schema.pipelines)
        .values({ workspaceId: ws.workspaceId, name })
        .returning();
      if (!p) throw new Error('pipeline');
      const [s] = await db
        .insert(schema.stages)
        .values({ workspaceId: ws.workspaceId, pipelineId: p.id, name: 'Novo', position: 0 })
        .returning();
      const [c] = await db
        .insert(schema.contacts)
        .values({ workspaceId: ws.workspaceId, displayName: 'Cliente Teste' })
        .returning();
      if (!s || !c) throw new Error('estágio/contato');
      const [d] = await db
        .insert(schema.deals)
        .values({
          workspaceId: ws.workspaceId,
          pipelineId: p.id,
          stageId: s.id,
          contactId: c.id,
          ownerId: ws.members.SUPERVISOR.id,
          title: `Negócio ${name}`,
        })
        .returning();
      if (!d) throw new Error('negócio');
      return { pipeline: p.id, deal: d.id };
    };
    const mine = await mk(main, 'Alinhadores');
    const theirs = await mk(other, 'Outra empresa');
    visiblePipeline = mine.pipeline;
    othersDeal = mine.deal; // do SUPERVISOR: invisível para o AGENT
    foreignPipeline = theirs.pipeline;
    foreignDeal = theirs.deal;
  });

  it('id visível vira o chip; o pedido leva o rótulo e o id', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    const result = await ask(owner, sessionId, {
      text: 'Como está?',
      page_context: { route: '/pipeline', filters: { pipelineId: visiblePipeline } },
    });
    expect(result.frames[0]).toMatchObject({
      type: 'turn_started',
      context_label: 'Vendo: Alinhadores',
    });
    const sent = runtimeCalls[runtimeCalls.length - 1];
    expect(sent?.page_context_resolved.label).toBe('Pipeline · Alinhadores');
    expect(sent?.page_context_resolved.entity_summary).toContain(visiblePipeline);
  });

  it('id de outro workspace ou invisível ao membro é descartado em silêncio', async () => {
    const agent = main.members.AGENT;
    const sessionId = await createSession(agent);
    const result = await ask(agent, sessionId, {
      text: 'E este?',
      page_context: {
        route: '/pipeline',
        entity: { type: 'deal', id: foreignDeal },
        selection: { type: 'deal', ids: [othersDeal, foreignDeal] },
        filters: { pipelineId: foreignPipeline },
      },
    });
    expect(result.status).toBe(200);
    expect(result.frames[0]).toMatchObject({ type: 'turn_started', context_label: null });
    const sent = runtimeCalls[runtimeCalls.length - 1];
    expect(sent?.page_context_resolved).toEqual({ label: 'Pipeline' });
    for (const id of [foreignDeal, othersDeal, foreignPipeline])
      expect(JSON.stringify(sent)).not.toContain(id);
    // O que fica gravado também só tem o que ele vê.
    const turnId = startedTurnId(result);
    const [msg] = await withWorkspace(main.workspaceId, (tx) =>
      tx
        .select()
        .from(schema.copilotMessages)
        .where(
          and(eq(schema.copilotMessages.turnId, turnId), eq(schema.copilotMessages.role, 'user')),
        ),
    );
    expect(msg?.pageContext).toEqual({ route: '/pipeline' });
  });

  it('campo extra no contexto (ou no corpo) → 400, sem turno', async () => {
    const owner = main.members.OWNER;
    const sessionId = await createSession(owner);
    const calls = runtimeCalls.length;
    const extraCtx = await ask(owner, sessionId, {
      text: 'Oi',
      page_context: { route: '/pipeline', member_id: owner.id },
    });
    expect(extraCtx.status).toBe(400);
    const extraBody = await ask(owner, sessionId, { text: 'Oi', workspace_id: other.workspaceId });
    expect(extraBody.status).toBe(400);
    expect(runtimeCalls.length).toBe(calls);
  });
});

describe('orçamento e só leitura', () => {
  async function setBudget(
    values: { monthlyBudgetUsd: string; budgetMode: 'queries_only' | 'pause' },
    spent: number,
  ) {
    await withWorkspace(budgetWs.workspaceId, async (tx) => {
      await tx
        .insert(schema.copilotSettings)
        .values({ workspaceId: budgetWs.workspaceId, ...values })
        .onConflictDoUpdate({ target: schema.copilotSettings.workspaceId, set: values });
      await tx
        .delete(schema.llmUsageLogs)
        .where(eq(schema.llmUsageLogs.workspaceId, budgetWs.workspaceId));
      await tx.insert(schema.llmUsageLogs).values([
        {
          workspaceId: budgetWs.workspaceId,
          requestType: 'chat',
          model: 'x',
          costUsd: spent.toFixed(8),
          surface: 'copilot',
        },
        // Gasto dos AGENTES: não conta no Copiloto.
        {
          workspaceId: budgetWs.workspaceId,
          requestType: 'chat',
          model: 'x',
          costUsd: '50.00000000',
          surface: 'agent',
        },
      ]);
    });
  }

  it('paused → budget_exceeded sem chamar o runtime e sem criar turno', async () => {
    await setBudget({ monthlyBudgetUsd: '1.00', budgetMode: 'pause' }, 1.5);
    const owner = budgetWs.members.OWNER;
    const sessionId = await createSession(owner);
    const calls = runtimeCalls.length;
    const result = await ask(owner, sessionId, { text: 'Ainda dá?' });
    expect(result.frames).toEqual([
      {
        v: 1,
        type: 'budget_exceeded',
        mode: 'pause',
        resets_on: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      },
    ]);
    expect(runtimeCalls.length).toBe(calls);
    const turns = await withWorkspace(budgetWs.workspaceId, (tx) =>
      tx.select().from(schema.copilotTurns).where(eq(schema.copilotTurns.sessionId, sessionId)),
    );
    expect(turns).toHaveLength(0);
  });

  it('queries_only: a pergunta passa e a escrita é recusada (proposta blocked, nada executa)', async () => {
    await setBudget({ monthlyBudgetUsd: '1.00', budgetMode: 'queries_only' }, 1.05);
    const owner = budgetWs.members.OWNER;
    const sessionId = await createSession(owner);
    const dealId = randomUUID();
    store.add(dealId);
    let writeEnvelope: CopilotToolEnvelope | null = null;
    let readEnvelope: CopilotToolEnvelope | null = null;
    script = async (run) => {
      readEnvelope = await run.callTool('test_list_deals', {});
      run.send({
        type: 'tool_call_completed',
        tool_key: 'test_list_deals',
        call_id: 'r',
        envelope: readEnvelope,
      });
      writeEnvelope = await run.callTool(MOVE_KEY, { ids: [dealId], to: 'Reativação' });
      run.send({
        type: 'tool_call_completed',
        tool_key: MOVE_KEY,
        call_id: 'w',
        envelope: writeEnvelope,
      });
      run.send(answer({ verdict: 'Consigo consultar, mas não mover agora.' }));
    };
    const result = await ask(owner, sessionId, { text: 'Move o negócio X' });
    expect(result.frames.map((f) => f.type)).toEqual([
      'turn_started',
      'tool_result',
      'action_blocked',
      'final',
    ]);
    expect((readEnvelope as CopilotToolEnvelope | null)?.decision).toBe('executed');
    expect((writeEnvelope as CopilotToolEnvelope | null)?.decision).toBe('blocked');
    expect(store.executeCalls).toHaveLength(0);
    expect(store.records.get(dealId)?.value).toBe('Orçamento enviado');
  });

  it('cap dos agentes inalterado: o teto dos agentes soma só surface=agent', async () => {
    await setBudget({ monthlyBudgetUsd: '1.00', budgetMode: 'queries_only' }, 1.05);
    const resolved = await resolvePolicy(budgetWs.workspaceId);
    expect(resolved.monthToDateSpendUsd).toBeCloseTo(50, 6);
    expect(
      await monthToDateSpendUsd(budgetWs.workspaceId, new Date(), undefined, {
        surface: 'copilot',
      }),
    ).toBeCloseTo(1.05, 6);
  });

  it('só leitura (assinatura vencida): criar sessão e perguntar passam', async () => {
    const owner = readOnlyWs.members.OWNER;
    const sessionId = await createSession(owner);
    const result = await ask(owner, sessionId, { text: 'Consulta em só leitura' });
    expect(result.status).toBe(200);
    expect(result.frames.map((f) => f.type)).toEqual(['turn_started', 'verdict_delta', 'final']);
  });
});
