/**
 * F56-S14 — retry durável de falha transitória do provider (INF-02).
 *
 * Três camadas:
 *  1. **Adapter WhatsApp** (real, com `fetch` stubado): 429/5xx/timeout LANÇAM
 *     `MetaError{retryable}`; erro de conteúdo devolve `SendResult.ok=false`.
 *  2. **Taxonomia** (pura): transitório vs permanente por erro e por resultado.
 *  3. **Worker**: transitório → `TransientSendError` (ladder durável) e NUNCA
 *     `failed`; esgotado → `failed` visível, sem lançar; permanente → `failed`
 *     imediato; reenvio não duplica (guard `findSentExternalId`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GraphClient,
  MetaError,
  MetaWhatsAppAdapter,
  type Channel,
  type IChannelAdapter,
  type SendResult,
} from '@hm/channels';
import type { Envelope } from '@hm/shared/mq';
import { handleOutboundEnvelope } from './worker';
// O portão de consentimento (F59-S05) é parte do pipeline: seu default é o
// portão REAL, que toca o banco. Estes testes exercitam roteamento/retry, não
// conformidade — então injetam explicitamente o permissivo. A conformidade tem
// suíte própria em `consent-gate.test.ts`.
import { allowAllConsentGate } from './consent-gate';
import {
  MAX_SEND_ATTEMPTS,
  TransientSendError,
  transientFailureFromError,
  transientFailureFromResult,
  type SendAttemptStore,
} from './retry-policy';
import type { OutboundDeps } from './ports';
import type { OutboundSendGuard } from './db-ports';

beforeEach(() => {
  // Guard/orphan store default batem no DB — sem DATABASE_URL eles no-opam.
  vi.stubEnv('DATABASE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── 1. Adapter WhatsApp: fronteira transitório × permanente ──────────────────

describe('MetaWhatsAppAdapter — falha transitória lança, permanente devolve', () => {
  const channel: Channel = {
    id: 'ch1',
    workspaceId: 'ws1',
    provider: 'meta_whatsapp',
    accessToken: 'tok',
    phoneNumberId: 'pn1',
  };

  /** GraphClient sem retry interno (maxAttempts=1) → 1 fetch por chamada. */
  function adapterWith(fetchImpl: typeof fetch): MetaWhatsAppAdapter {
    vi.stubGlobal('fetch', fetchImpl);
    return new MetaWhatsAppAdapter(new GraphClient({ maxAttempts: 1, timeoutMs: 50 }));
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const text = { contactRemoteId: '5511999', text: 'oi' };

  it('429 (rate limit) → lança MetaError retryable (não vira failed)', async () => {
    const adapter = adapterWith(async () =>
      jsonResponse(429, { error: { message: 'rate limited', code: 4 } }),
    );

    await expect(adapter.sendText(text, channel)).rejects.toThrow(MetaError);
    await expect(adapter.sendText(text, channel)).rejects.toMatchObject({ retryable: true });
  });

  it('500 (5xx) → lança MetaError retryable', async () => {
    const adapter = adapterWith(async () => jsonResponse(500, { error: { message: 'boom' } }));

    await expect(adapter.sendText(text, channel)).rejects.toMatchObject({
      retryable: true,
      httpStatus: 500,
    });
  });

  it('timeout/rede → lança MetaError retryable (httpStatus 0)', async () => {
    const adapter = adapterWith(async () => {
      throw new Error('ECONNRESET');
    });

    await expect(adapter.sendText(text, channel)).rejects.toMatchObject({
      retryable: true,
      httpStatus: 0,
    });
  });

  it('130429 (rate limit da WABA, HTTP 400) → lança: o mapa WA sabe que é temporário', async () => {
    const adapter = adapterWith(async () =>
      jsonResponse(400, { error: { message: 'throttled', code: 130429 } }),
    );

    await expect(adapter.sendText(text, channel)).rejects.toMatchObject({
      retryable: true,
      code: 130429,
    });
  });

  it('131026 (número sem WhatsApp) → PERMANENTE: SendResult failed, sem lançar', async () => {
    const adapter = adapterWith(async () =>
      jsonResponse(400, { error: { message: 'undeliverable', code: 131026 } }),
    );

    const res = await adapter.sendText(text, channel);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('WA_131026');
  });

  it('132001 (template inexistente) → PERMANENTE: SendResult failed', async () => {
    const adapter = adapterWith(async () =>
      jsonResponse(400, { error: { message: 'no template', code: 132001 } }),
    );

    const res = await adapter.sendTemplate(
      { contactRemoteId: '5511999', templateName: 'x', languageCode: 'pt_BR', components: [] },
      channel,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe('WA_132001');
  });

  it('sucesso continua sucesso (não regride)', async () => {
    const adapter = adapterWith(async () =>
      jsonResponse(200, { messages: [{ id: 'wamid.OK' }] }),
    );

    const res = await adapter.sendText(text, channel);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.externalId).toBe('wamid.OK');
  });
});

// ─── 2. Taxonomia (pura) ──────────────────────────────────────────────────────

describe('taxonomia transitório × permanente', () => {
  it('MetaError retryable → transitório, com errorCode do provider', () => {
    const err = new MetaError('throttled', { httpStatus: 400, code: 130429, retryable: true });
    expect(transientFailureFromError(err, 'meta_whatsapp')).toEqual({
      errorCode: 'WA_130429',
      errorMessage: 'throttled',
    });
  });

  it('MetaError sem código (5xx/timeout) → errorCode sintético estável', () => {
    expect(
      transientFailureFromError(new MetaError('x', { httpStatus: 0, retryable: true }), 'meta_whatsapp'),
    ).toMatchObject({ errorCode: 'WA_NETWORK' });
    expect(
      transientFailureFromError(new MetaError('x', { httpStatus: 503, retryable: true }), 'meta_instagram'),
    ).toMatchObject({ errorCode: 'IG_HTTP_503' });
  });

  it('MetaError permanente e erro genérico (bug/infra) → NÃO transitório', () => {
    expect(
      transientFailureFromError(new MetaError('bad', { httpStatus: 400, code: 131026 }), 'meta_whatsapp'),
    ).toBeNull();
    expect(transientFailureFromError(new Error('db down'), 'meta_whatsapp')).toBeNull();
  });

  it('resultados: rate limit / 5xx / rede são transitórios', () => {
    const codes = ['WA_130429', 'WA_131016', 'IG_4', 'IG_80007', 'WAHA_429', 'WAHA_503', 'WAHA_0'];
    for (const errorCode of codes) {
      const result: SendResult = { ok: false, errorCode, errorMessage: 'x' };
      expect(transientFailureFromResult(result), errorCode).not.toBeNull();
    }
  });

  it('resultados: conteúdo/config/janela/mismatch são permanentes (default seguro)', () => {
    const codes = [
      'WA_131026',
      'WA_131047',
      'WA_132001',
      'WA_UNKNOWN',
      'WA_NO_PHONE_NUMBER_ID',
      'WA_INTERACTIVE_INVALID',
      'IG_WINDOW_CLOSED',
      'IG_NO_HSM',
      'WAHA_400',
      'WAHA_404',
      'OUTBOUND_KIND_PROVIDER_MISMATCH',
      'UNSUPPORTED',
    ];
    for (const errorCode of codes) {
      const result: SendResult = { ok: false, errorCode, errorMessage: 'x' };
      expect(transientFailureFromResult(result), errorCode).toBeNull();
    }
  });

  it('sucesso nunca é falha', () => {
    expect(transientFailureFromResult({ ok: true, externalId: 'wamid.X' })).toBeNull();
  });
});

// ─── 3. Worker: política de reprocessamento ───────────────────────────────────

describe('handleOutboundEnvelope — retry durável (F56-S14)', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function (this: unknown) {
      return logger;
    }),
  };

  function makeChannel(): Channel {
    return {
      id: 'ch1',
      workspaceId: 'ws1',
      provider: 'meta_whatsapp',
      accessToken: 'tok',
      phoneNumberId: 'pn1',
    };
  }

  function baseAdapter(sendText: IChannelAdapter['sendText']): IChannelAdapter {
    const ok: SendResult = { ok: true, externalId: 'wamid.X' };
    return {
      provider: 'meta_whatsapp',
      capabilities: {
        templatesHSM: true,
        storyMentions: false,
        storyReplies: false,
        publicComments: false,
        messageTags: false,
        voicePtt: true,
        sticker: true,
        location: true,
      },
      parseInbound: vi.fn(async () => []),
      sendText,
      sendMedia: vi.fn(async () => ok),
      sendTemplate: vi.fn(async () => ok),
      sendInteractive: vi.fn(async () => ok),
      downloadMedia: vi.fn(async () => Buffer.alloc(0)),
      markAsRead: vi.fn(async () => undefined),
      sendTypingIndicator: vi.fn(async () => undefined),
    };
  }

  function fakeDeps(adapter: IChannelAdapter): {
    deps: OutboundDeps;
    persist: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  } {
    const persist = vi.fn(async () => undefined);
    const emit = vi.fn(async () => undefined);
    return {
      persist,
      emit,
      deps: {
        channels: { resolve: vi.fn(async () => ({ channel: makeChannel(), adapter })) },
        persistence: { persist },
        socket: { emitStatusChanged: emit, emitMessageNew: vi.fn(async () => undefined) },
      },
    };
  }

  function attemptStore(count: number): SendAttemptStore & { record: ReturnType<typeof vi.fn> } {
    return { record: vi.fn(async () => count) };
  }

  function guard(externalId: string | null): OutboundSendGuard {
    return { findSentExternalId: vi.fn(async () => externalId) };
  }

  const envelope: Envelope = {
    id: '00000000-0000-0000-0000-000000000010',
    type: 'outbound.text',
    workspaceId: '00000000-0000-0000-0000-0000000000ff',
    ts: Date.now(),
    payload: {
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: '5511999',
      text: 'oi',
    },
  };

  const transient = new MetaError('serviço indisponível', { httpStatus: 503, retryable: true });

  it('5xx do provider: LANÇA TransientSendError (ladder) e NÃO persiste failed', async () => {
    const adapter = baseAdapter(
      vi.fn(async () => {
        throw transient;
      }),
    );
    const d = fakeDeps(adapter);
    const attempts = attemptStore(1);

    await expect(
      handleOutboundEnvelope(envelope, {
        deps: d.deps,
        logger,
        consentGate: allowAllConsentGate,
        attempts,
        sendGuard: guard(null),
      }),
    ).rejects.toBeInstanceOf(TransientSendError);

    expect(d.persist).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
    expect(attempts.record).toHaveBeenCalledOnce();
    expect(attempts.record.mock.calls[0]?.[0]).toMatchObject({
      messageId: 'm1',
      failure: { errorCode: 'WA_HTTP_503' },
    });
  });

  it('esgotadas as tentativas: persiste failed (visível) e NÃO lança (sem DLQ)', async () => {
    const adapter = baseAdapter(
      vi.fn(async () => {
        throw transient;
      }),
    );
    const d = fakeDeps(adapter);
    const attempts = attemptStore(MAX_SEND_ATTEMPTS);

    await handleOutboundEnvelope(envelope, {
      deps: d.deps,
      logger,
      consentGate: allowAllConsentGate,
      attempts,
      sendGuard: guard(null),
    });

    expect(d.persist).toHaveBeenCalledOnce();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({
      status: 'failed',
      errorCode: 'WA_HTTP_503',
      messageId: 'm1',
    });
    expect(d.emit.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('falha PERMANENTE: failed imediato, sem contar tentativa e sem retry', async () => {
    const adapter = baseAdapter(
      vi.fn(async () => ({
        ok: false as const,
        errorCode: 'WA_131026',
        errorMessage: 'número sem WhatsApp',
      })),
    );
    const d = fakeDeps(adapter);
    const attempts = attemptStore(1);

    await handleOutboundEnvelope(envelope, {
      deps: d.deps,
      logger,
      consentGate: allowAllConsentGate,
      attempts,
      sendGuard: guard(null),
    });

    expect(attempts.record).not.toHaveBeenCalled();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({ status: 'failed', errorCode: 'WA_131026' });
  });

  it('falha transitória reportada por RESULTADO (IG/WAHA) também entra na ladder', async () => {
    const adapter = baseAdapter(
      vi.fn(async () => ({ ok: false as const, errorCode: 'WA_130429', errorMessage: 'throttled' })),
    );
    const d = fakeDeps(adapter);
    const attempts = attemptStore(2);

    await expect(
      handleOutboundEnvelope(envelope, {
        deps: d.deps,
        logger,
        consentGate: allowAllConsentGate,
        attempts,
        sendGuard: guard(null),
      }),
    ).rejects.toBeInstanceOf(TransientSendError);

    expect(d.persist).not.toHaveBeenCalled();
    expect(attempts.record).toHaveBeenCalledOnce();
  });

  it('erro de INFRA (não-provider) sobe intacto para a ladder genérica', async () => {
    const boom = new Error('db down');
    const adapter = baseAdapter(
      vi.fn(async () => {
        throw boom;
      }),
    );
    const d = fakeDeps(adapter);
    const attempts = attemptStore(1);

    await expect(
      handleOutboundEnvelope(envelope, { deps: d.deps, logger, consentGate: allowAllConsentGate, attempts, sendGuard: guard(null) }),
    ).rejects.toBe(boom);

    expect(attempts.record).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('reenvio após retry NÃO duplica: guard acha o external_id → adapter não é chamado', async () => {
    // Cenário real: o POST chegou a criar o wamid, a resposta se perdeu (timeout)
    // → a ladder reentrega o job. O guard de idempotência (F52-S04) impede o 2º envio.
    const sendText = vi.fn(async () => {
      throw transient;
    });
    const adapter = baseAdapter(sendText);
    const d = fakeDeps(adapter);

    // 1ª entrega: transitório → ladder.
    await expect(
      handleOutboundEnvelope(envelope, {
        deps: d.deps,
        logger,
        consentGate: allowAllConsentGate,
        attempts: attemptStore(1),
        sendGuard: guard(null),
      }),
    ).rejects.toBeInstanceOf(TransientSendError);
    expect(sendText).toHaveBeenCalledOnce();

    // Reentrega: a mensagem já tem external_id → não reenvia, só reconcilia p/ sent.
    await handleOutboundEnvelope(envelope, {
      deps: d.deps,
      logger,
      consentGate: allowAllConsentGate,
      attempts: attemptStore(2),
      sendGuard: guard('wamid.PRIOR'),
    });

    expect(sendText).toHaveBeenCalledOnce(); // continua 1× — sem mensagem duplicada
    expect(d.persist).toHaveBeenCalledOnce();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({
      status: 'sent',
      externalId: 'wamid.PRIOR',
    });
  });

  it('typing_indicator transitório: descarta (presença é perecível) — sem retry e sem persist', async () => {
    const adapter = baseAdapter(vi.fn(async () => ({ ok: true as const, externalId: 'x' })));
    const typingAdapter: IChannelAdapter = {
      ...adapter,
      sendTypingIndicator: vi.fn(async () => {
        throw transient;
      }),
    };
    const d = fakeDeps(typingAdapter);
    const attempts = attemptStore(1);

    await handleOutboundEnvelope(
      {
        ...envelope,
        payload: {
          kind: 'typing_indicator',
          channelId: 'ch1',
          conversationId: 'cv1',
          messageId: 'm1',
          chatId: '5511999',
          targetExternalId: 'wamid.IN',
          presence: 'typing',
        },
      },
      { deps: d.deps, logger, consentGate: allowAllConsentGate, attempts, sendGuard: guard(null) },
    );

    expect(attempts.record).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
  });
});
