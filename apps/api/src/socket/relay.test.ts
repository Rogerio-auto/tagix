/**
 * F56-S16 — contrato de confiabilidade do relay de socket (INF-09/INF-11/INF-13).
 *
 * O que estes testes travam (regressões que já causaram "o tempo real some"):
 *  - o emit NUNCA depende do Redis: bump que falha, que rejeita ou que PENDURA
 *    não pode engolir o evento;
 *  - no caminho feliz o bump acontece ANTES do emit (senão o refetch do cliente
 *    lê a ChatList cacheada e velha — o bug do commit 4fe4b0ff);
 *  - eventos de alta frequência que não mudam a lista não bumpam;
 *  - rajadas coalescem o bump (PERF-05: evita stampede de cache);
 *  - payload inválido é descartado com log, sem derrubar o handler.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import type { Envelope } from '@hm/shared/mq';
import type { ServerToClientEvent } from '@hm/shared';
import { createRelayHandler, inboundParaNotificar } from './relay';

const WS = '11111111-1111-4111-8111-111111111111';

function envelope(event: ServerToClientEvent, extra: Record<string, unknown> = {}): Envelope {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    type: 'socket.relay',
    workspaceId: WS,
    ts: Date.now(),
    payload: { event, data: { hello: 'world' }, ...extra },
  };
}

function fakeLogger(): Logger {
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => log,
  };
  return log;
}

interface Emitted {
  rooms: readonly string[];
  event: ServerToClientEvent;
  data: unknown;
}

function harness(overrides: {
  bumpVersion?: (key: string) => Promise<void>;
  bumpTimeoutMs?: number;
  logEmits?: boolean;
  countSockets?: (room: string) => number;
}) {
  const emitted: Emitted[] = [];
  const trace: string[] = [];
  const logger = fakeLogger();
  const handler = createRelayHandler({
    emit: (rooms, event, data) => {
      trace.push('emit');
      emitted.push({ rooms, event, data });
    },
    bumpVersion: overrides.bumpVersion ?? (async () => undefined),
    ...(overrides.bumpTimeoutMs !== undefined ? { bumpTimeoutMs: overrides.bumpTimeoutMs } : {}),
    ...(overrides.logEmits !== undefined ? { logEmits: overrides.logEmits } : {}),
    ...(overrides.countSockets ? { countSockets: overrides.countSockets } : {}),
    logger,
  });
  return { handler, emitted, trace, logger };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('relay — o emit não depende do cache (INF-09)', () => {
  it('emite mesmo quando o bump de versão REJEITA (blip de Redis)', async () => {
    const { handler, emitted } = harness({
      bumpVersion: () => Promise.reject(new Error('ECONNREFUSED redis')),
    });

    await expect(handler(envelope('message:new'))).resolves.toBeUndefined();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe('message:new');
    expect(emitted[0]?.rooms).toEqual([`ws:${WS}`]);
    expect(emitted[0]?.data).toEqual({ hello: 'world' });
  });

  it('emite mesmo quando o bump LANÇA de forma síncrona', async () => {
    const { handler, emitted } = harness({
      bumpVersion: () => {
        throw new Error('redis client destruído');
      },
    });

    await expect(handler(envelope('conversation:updated'))).resolves.toBeUndefined();
    expect(emitted).toHaveLength(1);
  });

  it('emite dentro do prazo quando o bump PENDURA (Redis sem responder)', async () => {
    const { handler, emitted } = harness({
      bumpVersion: () => new Promise<void>(() => undefined), // nunca resolve
      bumpTimeoutMs: 20,
    });

    const started = Date.now();
    await handler(envelope('message:new'));

    expect(emitted).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('loga a degradação UMA vez (sem flood), e a normalização ao voltar', async () => {
    let fail = true;
    const { handler, logger } = harness({
      bumpVersion: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve()),
    });

    await handler(envelope('message:new'));
    await handler(envelope('message:new'));
    await handler(envelope('message:new'));
    expect(logger.warn).toHaveBeenCalledTimes(1);

    fail = false;
    await handler(envelope('message:new'));
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('relay — ordem bump→emit e seleção de eventos', () => {
  it('bumpa ANTES de emitir (o refetch do cliente precisa ver a versão nova)', async () => {
    const trace: string[] = [];
    const emitted: Emitted[] = [];
    const handler = createRelayHandler({
      emit: (rooms, event, data) => {
        trace.push('emit');
        emitted.push({ rooms, event, data });
      },
      bumpVersion: async (key) => {
        await tick();
        trace.push(`bump:${key}`);
      },
      logger: fakeLogger(),
    });

    await handler(envelope('message:new'));

    expect(trace).toEqual([`bump:hm:ws:v:${WS}`, 'emit']);
    expect(emitted).toHaveLength(1);
  });

  it('NÃO bumpa em eventos de alta frequência que não mudam a lista', async () => {
    const bump = vi.fn(async () => undefined);
    const { handler, emitted } = harness({ bumpVersion: bump });

    await handler(envelope('message:status_changed'));
    await handler(envelope('typing:from_contact'));

    expect(bump).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(2);
  });

  it('roteia por room explícita, por target e cai no workspace por default', async () => {
    const { handler, emitted } = harness({});

    await handler(envelope('message:new', { room: 'support:42' }));
    await handler(
      envelope('message:new', {
        target: { conversationId: 'c1', memberId: 'm1', workspace: true },
      }),
    );
    await handler(envelope('typing:from_contact'));

    expect(emitted[0]?.rooms).toEqual(['support:42']);
    expect(emitted[1]?.rooms).toEqual(['conversation:c1', 'member:m1', `ws:${WS}`]);
    expect(emitted[2]?.rooms).toEqual([`ws:${WS}`]);
  });
});

describe('relay — coalescência do bump (PERF-05)', () => {
  it('uma rajada do mesmo workspace compartilha um único INCR', async () => {
    const bump = vi.fn(async () => {
      await tick();
    });
    const { handler, emitted } = harness({ bumpVersion: bump });

    // 5 eventos entram antes de qualquer INCR começar → 1 INCR cobre todos.
    await Promise.all([
      handler(envelope('message:new')),
      handler(envelope('message:new')),
      handler(envelope('message:new')),
      handler(envelope('conversation:updated')),
      handler(envelope('conversation:assigned')),
    ]);

    expect(bump).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(5);
  });

  it('evento que chega com INCR EM VOO ganha um INCR novo (nunca reusa um já iniciado)', async () => {
    const bump = vi.fn(async () => {
      await tick();
    });
    const { handler, emitted } = harness({ bumpVersion: bump });

    const first = handler(envelope('message:new'));
    await Promise.resolve(); // o INCR do 1º já começou
    const later = handler(envelope('message:new'));

    await Promise.all([first, later]);

    expect(bump).toHaveBeenCalledTimes(2);
    expect(emitted).toHaveLength(2);
  });

  it('workspaces distintos não compartilham bump', async () => {
    const keys: string[] = [];
    const { handler, emitted } = harness({
      bumpVersion: async (key) => {
        keys.push(key);
        await tick();
      },
    });
    const other = { ...envelope('message:new'), workspaceId: '33333333-3333-4333-8333-333333333333' };

    await Promise.all([handler(envelope('message:new')), handler(other)]);

    expect(keys.sort()).toEqual(
      [`hm:ws:v:${WS}`, 'hm:ws:v:33333333-3333-4333-8333-333333333333'].sort(),
    );
    expect(emitted).toHaveLength(2);
  });
});

describe('relay — payload e logging', () => {
  it('descarta payload inválido com log de erro, sem lançar nem emitir', async () => {
    const { handler, emitted, logger } = harness({});

    await expect(
      handler({ ...envelope('message:new'), payload: { event: 'evento:inexistente' } }),
    ).resolves.toBeUndefined();

    expect(emitted).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('log por-emit fica em debug e só conta sockets quando ligado (INF-13/PERF-04)', async () => {
    const countSockets = vi.fn(() => 3);
    const off = harness({ logEmits: false, countSockets });
    await off.handler(envelope('typing:from_contact'));
    expect(countSockets).not.toHaveBeenCalled();
    expect(off.logger.debug).not.toHaveBeenCalled();
    expect(off.logger.info).not.toHaveBeenCalled();

    const on = harness({ logEmits: true, countSockets });
    await on.handler(envelope('typing:from_contact'));
    expect(countSockets).toHaveBeenCalledWith(`ws:${WS}`);
    expect(on.logger.debug).toHaveBeenCalledWith('relay emit', {
      event: 'typing:from_contact',
      rooms: [`ws:${WS}=3`],
    });
  });
});

/**
 * F61-S04 — o gancho de notificação pendurado no relay.
 *
 * O relay é o último trecho entre o banco e o navegador. Se ele engolir ou
 * atrasar um evento, o sintoma é "o tempo real some às vezes" — caro de
 * diagnosticar e péssimo de explicar. Estes testes existem para que o aviso ao
 * dono nunca ganhe esse poder.
 */
describe('F61-S04 — notificação de inbound', () => {
  const msgNova = (message: unknown) => ({
    id: 'env-1',
    type: 'socket.relay',
    workspaceId: 'ws-1',
    ts: Date.now(),
    payload: {
      event: 'message:new',
      target: { conversationId: 'conv-1' },
      data: { workspaceId: 'ws-1', conversationId: 'conv-1', message },
    },
  });

  it('extrai conversa e mensagem de um inbound do contato', () => {
    expect(inboundParaNotificar({ conversationId: 'c1', message: { id: 'm1', senderType: 'contact' } }))
      .toEqual({ conversationId: 'c1', messageId: 'm1' });
  });

  it('NÃO notifica a própria resposta do atendente', () => {
    // Avisar o dono da mensagem que ele acabou de mandar é a forma mais rápida
    // de ele desligar as notificações.
    for (const sender of ['member', 'agent', 'system']) {
      expect(
        inboundParaNotificar({ conversationId: 'c1', message: { id: 'm1', senderType: sender } }),
      ).toBeNull();
    }
  });

  it('payload de formato inesperado não vira notificação nem exceção', () => {
    // Uma versão futura do worker não pode derrubar o relay.
    for (const lixo of [null, undefined, 'texto', 42, {}, { conversationId: 'c1' }]) {
      expect(inboundParaNotificar(lixo)).toBeNull();
    }
    expect(inboundParaNotificar({ conversationId: 'c1', message: { senderType: 'contact' } })).toBeNull();
  });

  it('o emit acontece ANTES e INDEPENDENTE do aviso', async () => {
    const ordem: string[] = [];
    let resolverAviso: (() => void) | undefined;
    const handler = createRelayHandler({
      emit: () => ordem.push('emit'),
      bumpVersion: () => Promise.resolve(),
      notifyInbound: () =>
        new Promise<void>((r) => {
          ordem.push('aviso-iniciado');
          resolverAviso = r;
        }),
    });

    // Não aguardamos o aviso: se o handler esperasse por ele, este await
    // penduraria para sempre e o teste estouraria o timeout.
    await handler(msgNova({ id: 'm1', senderType: 'contact' }));

    expect(ordem).toEqual(['emit', 'aviso-iniciado']);
    resolverAviso?.();
  });

  it('aviso que REJEITA não derruba o relay', async () => {
    const emitidos: string[] = [];
    const handler = createRelayHandler({
      emit: (_r, event) => emitidos.push(event),
      bumpVersion: () => Promise.resolve(),
      notifyInbound: () => Promise.reject(new Error('push fora do ar')),
    });

    await expect(handler(msgNova({ id: 'm1', senderType: 'contact' }))).resolves.toBeUndefined();
    expect(emitidos).toEqual(['message:new']);
  });
});
