/**
 * F60-S08 — webhook de e-mail.
 *
 * O que importa aqui é o que acontece com payload de terceiro: assinatura
 * recusada, HTML sanitizado antes de sair, e bounce decidindo supressão.
 */
import express from 'express';
import request from 'supertest';
import { FakeEmailProvider } from '@hm/channels';
import { describe, expect, it, vi } from 'vitest';
import { createEmailWebhookRouter, normalizeInbound } from './email';

const SEGREDO = 'segredo-do-webhook';

type Deps = Parameters<typeof createEmailWebhookRouter>[0];

function app(over: Partial<Deps> = {}) {
  // Mocks tipados pela assinatura da porta: sem isso o TS infere tupla de
  // argumentos vazia e `mock.calls[0]` fica inacessivel.
  const onInbound = vi.fn<Deps['onInbound']>(async () => undefined);
  const onEvent = vi.fn<Deps['onEvent']>(async () => undefined);
  const a = express();
  a.use(
    createEmailWebhookRouter({
      provider: new FakeEmailProvider({ webhookSecret: SEGREDO }),
      onInbound,
      onEvent,
      ...over,
    }),
  );
  return { a, onInbound, onEvent };
}

const inbound = {
  messageId: '<r1@cliente.com>',
  from: 'lead@exemplo.com',
  to: ['orcamento@sunrise.com'],
  subject: 'Re: Orçamento',
  text: 'quanto fica?',
};

describe('assinatura', () => {
  it('recusa payload não assinado — é o que impede forjar um bounce', async () => {
    const { a, onInbound } = app();
    const r = await request(a).post('/webhooks/email/inbound').send(inbound);
    expect(r.status).toBe(403);
    expect(onInbound).not.toHaveBeenCalled();
  });

  it('recusa assinatura errada', async () => {
    const { a } = app();
    const r = await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', 'errada')
      .send(inbound);
    expect(r.status).toBe(403);
  });

  it('a rota de eventos também recusa — ela decide SUPRESSÃO', async () => {
    const { a, onEvent } = app();
    const r = await request(a)
      .post('/webhooks/email/events')
      .send([{ kind: 'hard_bounce', messageId: '<a@b>', recipient: 'x@y.com' }]);
    expect(r.status).toBe(403);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('não diz o que faltou — ajudaria quem está tentando forjar', async () => {
    const { a } = app();
    const r = await request(a).post('/webhooks/email/inbound').send(inbound);
    expect(JSON.stringify(r.body)).not.toMatch(/segredo|header|x-signature/i);
  });
});

describe('inbound assinado', () => {
  it('entrega o e-mail normalizado ao pipeline', async () => {
    const { a, onInbound } = app();
    const r = await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send(inbound);

    expect(r.status).toBe(200);
    expect(onInbound).toHaveBeenCalledOnce();
    const arg = onInbound.mock.calls[0]?.[0];
    expect(arg?.from).toBe('lead@exemplo.com');
    expect(arg?.messageId).toBe('r1@cliente.com');
  });

  it('payload irreconhecível responde 200, não erro', async () => {
    // Devolver erro faria o provedor reenviar para sempre algo que nunca vamos
    // entender.
    const { a, onInbound } = app();
    const r = await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send({ sem: 'nada util' });
    expect(r.status).toBe(200);
    expect(r.body.ignored).toBe(true);
    expect(onInbound).not.toHaveBeenCalled();
  });

  it('corpo que não é JSON responde 400', async () => {
    const { a } = app();
    const r = await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .set('content-type', 'application/json')
      .send('nao é json');
    expect(r.status).toBe(400);
  });
});

describe('o HTML que chega ao pipeline já está limpo', () => {
  it('script não sobrevive à normalização', () => {
    const n = normalizeInbound({
      messageId: 'm@x',
      from: { email: 'a@b.com' },
      to: [],
      subject: 's',
      text: '',
      html: '<p>oi</p><script>alert(document.cookie)</script>',
      inReplyTo: null,
      references: [],
      receivedAt: new Date(),
      attachments: [],
    });
    expect(n.html).not.toContain('script');
    expect(n.html).not.toContain('alert');
    expect(n.html).toContain('oi');
  });

  it('texto ausente é derivado do HTML JÁ sanitizado, nunca do cru', () => {
    // A prévia da conversa também é superfície de renderização.
    const n = normalizeInbound({
      messageId: 'm@x',
      from: { email: 'a@b.com' },
      to: [],
      subject: 's',
      text: '   ',
      html: '<script>alert(1)</script><p>conteudo real</p>',
      inReplyTo: null,
      references: [],
      receivedAt: new Date(),
      attachments: [],
    });
    expect(n.text).toBe('conteudo real');
    expect(n.text).not.toContain('alert');
  });

  it('chega sanitizado pela rota, não só pela função', async () => {
    const { a, onInbound } = app();
    await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send({ ...inbound, html: '<img src=x onerror="alert(1)"><p>ok</p>' });

    const arg = onInbound.mock.calls[0]?.[0];
    expect(arg?.html).not.toContain('onerror');
    expect(arg?.html).toContain('ok');
  });
});

describe('eventos de retorno', () => {
  it('bounce duro manda suprimir', async () => {
    const { a, onEvent } = app();
    const r = await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([{ kind: 'hard_bounce', messageId: '<a@b>', recipient: 'morto@x.com' }]);

    expect(r.status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'suppress', reason: 'hard_bounce', recipient: 'morto@x.com' }),
    );
  });

  it('bounce leve NÃO suprime na primeira vez', async () => {
    const { a, onEvent } = app();
    await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([{ kind: 'soft_bounce', messageId: '<a@b>', recipient: 'ferias@x.com' }]);

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'record' }));
  });

  it('bounce leve repetido acima do limite passa a suprimir', async () => {
    const { a, onEvent } = app({ softBounceCount: async () => 10 });
    await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([{ kind: 'soft_bounce', messageId: '<a@b>', recipient: 'cheia@x.com' }]);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'suppress', reason: 'soft_bounce_exhausted' }),
    );
  });

  it('reclamação de spam suprime', async () => {
    const { a, onEvent } = app();
    await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([{ kind: 'complaint', messageId: '<a@b>', recipient: 'irritado@x.com' }]);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'suppress', reason: 'complaint' }),
    );
  });

  it('entrega não mexe no endereço', async () => {
    const { a, onEvent } = app();
    await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([{ kind: 'delivered', messageId: '<a@b>', recipient: 'ok@x.com' }]);

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'none' }));
  });

  it('processa o lote inteiro e informa quantos', async () => {
    const { a, onEvent } = app();
    const r = await request(a)
      .post('/webhooks/email/events')
      .set('x-signature', SEGREDO)
      .send([
        { kind: 'delivered', messageId: '<a@b>', recipient: 'a@x.com' },
        { kind: 'hard_bounce', messageId: '<c@d>', recipient: 'b@x.com' },
      ]);

    expect(r.body.processed).toBe(2);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});
