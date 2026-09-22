import { describe, expect, it } from 'vitest';
import { FakeEmailProvider } from './fake-provider';
import type { SendEmailInput } from './provider';

function envio(over: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    stream: 'transactional',
    from: { email: 'obra@cliente.com', name: 'Sunrise Remodeling' },
    to: [{ email: 'lead@exemplo.com' }],
    subject: 'Seu orçamento',
    text: 'Segue o orçamento da cozinha.',
    ...over,
  };
}

describe('envio', () => {
  it('devolve um Message-ID e registra o enviado', async () => {
    const p = new FakeEmailProvider();
    const r = await p.send(envio());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toContain('@');
    expect(p.sent).toHaveLength(1);
  });

  it('recusa sem destinatário e sem assunto', async () => {
    const p = new FakeEmailProvider();
    const semTo = await p.send(envio({ to: [] }));
    const semAssunto = await p.send(envio({ subject: '   ' }));
    expect(semTo.ok).toBe(false);
    expect(semAssunto.ok).toBe(false);
    expect(p.sent).toHaveLength(0);
  });

  it('broadcast SEM List-Unsubscribe é recusado', async () => {
    // Falhar aqui é melhor que entregar no spam e descobrir quando o cliente
    // reclamar que ninguém recebe. E é a forma mais barata de honrar revogação.
    const p = new FakeEmailProvider();
    const r = await p.send(envio({ stream: 'broadcast' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('missing_list_unsubscribe');
  });

  it('broadcast COM List-Unsubscribe passa', async () => {
    const p = new FakeEmailProvider();
    const r = await p.send(
      envio({ stream: 'broadcast', listUnsubscribeUrl: 'https://x/u/abc' }),
    );
    expect(r.ok).toBe(true);
  });

  it('falha injetada percorre o caminho de erro', async () => {
    const p = new FakeEmailProvider({
      failWith: { errorCode: 'provider_down', errorMessage: 'indisponível' },
    });
    const r = await p.send(envio());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('provider_down');
  });

  it('preserva o encadeamento declarado', async () => {
    const p = new FakeEmailProvider();
    await p.send(envio({ inReplyTo: '<raiz@x>', references: ['<raiz@x>'] }));
    expect(p.sent[0]?.input.inReplyTo).toBe('<raiz@x>');
    expect(p.sent[0]?.input.references).toEqual(['<raiz@x>']);
  });
});

describe('inbound', () => {
  it('normaliza ids e referências', () => {
    const p = new FakeEmailProvider();
    const email = p.parseInbound({
      messageId: '<r1@cliente.com>',
      from: 'lead@exemplo.com',
      fromName: 'Lead',
      to: ['obra@cliente.com'],
      subject: 'Re: Seu orçamento',
      text: 'quanto fica?',
      inReplyTo: '<raiz@x>',
      references: '<raiz@x> <r0@x>',
    });
    expect(email?.messageId).toBe('r1@cliente.com');
    expect(email?.inReplyTo).toBe('raiz@x');
    expect(email?.references).toEqual(['raiz@x', 'r0@x']);
    expect(email?.from.name).toBe('Lead');
  });

  it('payload sem messageId ou sem remetente é descartado', () => {
    const p = new FakeEmailProvider();
    expect(p.parseInbound({ from: 'x@y.com' })).toBeNull();
    expect(p.parseInbound({ messageId: '<a@b>' })).toBeNull();
    expect(p.parseInbound(null)).toBeNull();
    expect(p.parseInbound('texto')).toBeNull();
  });

  it('data inválida cai para agora em vez de virar Invalid Date', () => {
    const p = new FakeEmailProvider();
    const email = p.parseInbound({
      messageId: '<a@b>',
      from: 'x@y.com',
      receivedAt: 'não é data',
    });
    expect(email?.receivedAt.getTime()).not.toBeNaN();
  });
});

describe('eventos de retorno', () => {
  it('reconhece os tipos conhecidos e ignora o resto', () => {
    const p = new FakeEmailProvider();
    const eventos = p.parseEvents([
      { kind: 'hard_bounce', messageId: '<a@b>', recipient: 'x@y.com' },
      { kind: 'delivered', messageId: '<c@d>', recipient: 'z@y.com' },
      { kind: 'inventado', messageId: '<e@f>', recipient: 'w@y.com' },
      { kind: 'complaint', messageId: '<g@h>' },
      'lixo',
    ]);
    expect(eventos.map((e) => e.kind)).toEqual(['hard_bounce', 'delivered']);
    expect(eventos[0]?.messageId).toBe('a@b');
  });

  it('payload que não é lista devolve vazio', () => {
    const p = new FakeEmailProvider();
    expect(p.parseEvents({ kind: 'delivered' })).toEqual([]);
    expect(p.parseEvents(null)).toEqual([]);
  });
});

describe('assinatura do webhook', () => {
  it('sem segredo configurado, recusa tudo — default seguro', () => {
    // Aceitar payload não assinado deixaria alguém forjar um hard_bounce e
    // suprimir o contato de um cliente.
    const p = new FakeEmailProvider();
    expect(p.verifyWebhook('{}', { 'x-signature': 'qualquer' })).toBe(false);
  });

  it('com segredo, aceita só a assinatura correta', () => {
    const p = new FakeEmailProvider({ webhookSecret: 'segredo' });
    expect(p.verifyWebhook('{}', { 'x-signature': 'segredo' })).toBe(true);
    expect(p.verifyWebhook('{}', { 'x-signature': 'errado' })).toBe(false);
    expect(p.verifyWebhook('{}', {})).toBe(false);
  });
});
