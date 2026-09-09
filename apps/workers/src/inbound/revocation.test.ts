/**
 * F59-S06 — o passo de revogação dentro do pipeline inbound.
 *
 * A DETECÇÃO é testada sem I/O em `@hm/shared/revocation.test.ts` (48 casos,
 * incluindo 15 de falso positivo). Aqui o que importa é a integração: o passo
 * roda antes de persistir, não derruba o inbound quando falha, e a mensagem do
 * cliente continua sendo gravada de qualquer forma.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InboundEvent } from '@hm/channels';
import { runInboundPipeline } from './pipeline';
import type { InboundDeps } from './ports';
import { noopRevocationStep, type RevocationPort } from './revocation';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function mensagem(content: string): InboundEvent {
  return {
    type: 'message',
    provider: 'meta_whatsapp',
    contactRemoteId: '5511999999999',
    externalId: 'wamid.ABC',
    messageType: 'text',
    content,
    rawTimestamp: '1781452828',
  };
}

function deps(over: Partial<InboundDeps> = {}): {
  deps: InboundDeps;
  persist: ReturnType<typeof vi.fn>;
} {
  const persist = vi.fn(async () => ({
    inserted: 1,
    deduped: 0,
    statuses: 0,
    resolved: true,
  }));
  return {
    persist,
    deps: {
      parser: { parse: vi.fn(() => [mensagem('oi')]) },
      persistence: { persist },
      media: { enqueue: vi.fn(async () => undefined) },
      revocation: noopRevocationStep,
      ...over,
    },
  };
}

const RAW = {
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn1' } } }] }],
};

describe('o passo roda antes de persistir', () => {
  it('é chamado com provider, routing e eventos', async () => {
    // Tipar o mock pela assinatura da porta: sem isso o TS infere tupla de
    // argumentos vazia e `mock.calls[0]` fica inacessível.
    const handle = vi.fn<RevocationPort['handle']>(async () => ({ suppressed: 0, flagged: 0 }));
    const revocation: RevocationPort = { handle };
    const d = deps({
      parser: { parse: vi.fn(() => [mensagem('pare')]) },
      revocation,
    });

    await runInboundPipeline('meta_whatsapp', RAW, d.deps, logger);

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(
      'meta_whatsapp',
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ type: 'message' })]),
      expect.anything(),
    );
  });

  it('roda ANTES da persistência — a supressão precisa valer para a resposta do agente', async () => {
    const ordem: string[] = [];
    const revocation: RevocationPort = {
      handle: vi.fn(async () => {
        ordem.push('revocation');
        return { suppressed: 1, flagged: 0 };
      }),
    };
    const persist = vi.fn(async () => {
      ordem.push('persist');
      return { inserted: 1, deduped: 0, statuses: 0, resolved: true };
    });
    const d = deps({
      parser: { parse: vi.fn(() => [mensagem('pare')]) },
      persistence: { persist },
      revocation,
    });

    await runInboundPipeline('meta_whatsapp', RAW, d.deps, logger);
    expect(ordem).toEqual(['revocation', 'persist']);
  });
});

describe('falha no passo não derruba o inbound', () => {
  it('a mensagem do cliente continua sendo persistida', async () => {
    // Perder a mensagem de quem escreveu é pior que honrar a revogação um ciclo
    // depois. O erro fica visível no log e o pipeline segue.
    const revocation: RevocationPort = {
      handle: vi.fn(async () => {
        throw new Error('banco indisponível');
      }),
    };
    const d = deps({ parser: { parse: vi.fn(() => [mensagem('pare')]) }, revocation });

    const r = await runInboundPipeline('meta_whatsapp', RAW, d.deps, logger);

    expect(r.persisted).toBe(true);
    expect(d.persist).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('composição sem o passo', () => {
  it('pipeline funciona quando `revocation` não é injetado', async () => {
    const d = deps({ revocation: undefined });
    const r = await runInboundPipeline('meta_whatsapp', RAW, d.deps, logger);
    expect(r.persisted).toBe(true);
  });

  it('o passo inerte não interfere', async () => {
    const d = deps({ revocation: noopRevocationStep });
    const r = await runInboundPipeline('meta_whatsapp', RAW, d.deps, logger);
    expect(r.persisted).toBe(true);
    expect(d.persist).toHaveBeenCalledOnce();
  });
});
