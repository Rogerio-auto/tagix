/**
 * F60-S08 — webhook de e-mail.
 *
 * O que importa aqui é o que acontece com payload de terceiro: assinatura
 * recusada, HTML sanitizado antes de sair, e bounce decidindo supressão.
 */
import { Buffer } from 'node:buffer';
import express from 'express';
import request from 'supertest';
import { FakeEmailProvider } from '@hm/channels';
import { describe, expect, it, vi } from 'vitest';
import { createEmailWebhookRouter, normalizeInbound, safeAttachmentName } from './email';

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

describe('anexos na borda (F60-S10)', () => {
  it('anexo em base64 atravessa como base64, com o tamanho real', async () => {
    const { a, onInbound } = app();
    const conteudo = Buffer.from('%PDF-1.4 orçamento');
    await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send({
        ...inbound,
        attachments: [
          {
            filename: 'orcamento.pdf',
            contentType: 'application/pdf',
            content: conteudo.toString('base64'),
          },
        ],
      });

    const arg = onInbound.mock.calls[0]?.[0];
    expect(arg?.attachments).toEqual([
      {
        kind: 'inline',
        filename: 'orcamento.pdf',
        contentType: 'application/pdf',
        contentId: null,
        contentBase64: conteudo.toString('base64'),
        sizeBytes: conteudo.length,
      },
    ]);
    expect(arg?.rejectedAttachments).toEqual([]);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/x',
    'https://10.1.2.3/x',
    'https://user:pw@files.provedor.com/x',
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/_FLUSHALL',
  ])('anexo por URL interna/insegura é recusado na borda: %s', async (url) => {
    const { a, onInbound } = app();
    await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send({
        ...inbound,
        attachments: [{ filename: 'x.pdf', contentType: 'application/pdf', url }],
      });

    const arg = onInbound.mock.calls[0]?.[0];
    expect(arg?.attachments).toEqual([]);
    // Recusado, mas registrado: o atendente vê que o cliente mandou algo.
    expect(arg?.rejectedAttachments).toEqual([{ filename: 'x.pdf', reason: 'unsafe_url' }]);
  });

  it('URL pública https segue para o worker, que revalida no connect', async () => {
    const { a, onInbound } = app();
    await request(a)
      .post('/webhooks/email/inbound')
      .set('x-signature', SEGREDO)
      .send({
        ...inbound,
        attachments: [
          { filename: 'foto.jpg', contentType: 'image/jpeg', url: 'https://files.provedor.com/a/1' },
        ],
      });
    const arg = onInbound.mock.calls[0]?.[0];
    expect(arg?.attachments[0]).toMatchObject({
      kind: 'remote',
      url: 'https://files.provedor.com/a/1',
    });
  });
});

describe('safeAttachmentName', () => {
  it('tira caminho, controle e marcador bidirecional', () => {
    expect(safeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('C:\\Windows\\system32\\x.dll')).toBe('x.dll');
    // U+202E faria `fatura\u202Efdp.exe` aparecer como "faturaexe.pdf".
    expect(safeAttachmentName('fatura\u202Efdp.exe')).toBe('faturafdp.exe');
    expect(safeAttachmentName('a\u0000b.txt')).toBe('ab.txt');
  });

  it('nome vazio ou só pontos vira "anexo"; nome gigante é cortado mantendo a extensão', () => {
    expect(safeAttachmentName('')).toBe('anexo');
    expect(safeAttachmentName('...')).toBe('anexo');
    const longo = safeAttachmentName(`${'a'.repeat(500)}.pdf`);
    expect(longo.length).toBe(180);
    expect(longo.endsWith('.pdf')).toBe(true);
  });
});
