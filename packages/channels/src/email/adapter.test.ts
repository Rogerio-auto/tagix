import { describe, expect, it } from 'vitest';
import { EMAIL_CAPABILITIES, EmailChannelAdapter } from './adapter';
import { FakeEmailProvider } from './fake-provider';
import type { Channel } from '../types';

const canal: Channel = {
  id: 'ch-email',
  workspaceId: 'ws1',
  provider: 'email',
  accessToken: 'tok',
  emailFrom: 'orcamento@sunrise.com',
  emailFromName: 'Sunrise Remodeling',
  emailDomain: 'sunrise.com',
};

function adapter(p = new FakeEmailProvider()): {
  adapter: EmailChannelAdapter;
  provider: FakeEmailProvider;
} {
  return { adapter: new EmailChannelAdapter(p), provider: p };
}

describe('envio de texto', () => {
  it('envia com assunto declarado e devolve o Message-ID como externalId', async () => {
    const { adapter: a, provider } = adapter();
    const r = await a.sendText(
      {
        contactRemoteId: 'lead@exemplo.com',
        text: 'Segue o orçamento.',
        email: { subject: 'Orçamento da cozinha' },
      },
      canal,
    );

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.externalId).toContain('@');
    expect(provider.sent[0]?.input.subject).toBe('Orçamento da cozinha');
    expect(provider.sent[0]?.input.to[0]?.email).toBe('lead@exemplo.com');
    expect(provider.sent[0]?.input.from.email).toBe('orcamento@sunrise.com');
  });

  it('deriva "Re: ..." do assunto da thread quando não vem assunto explícito', async () => {
    const { adapter: a, provider } = adapter();
    await a.sendText(
      {
        contactRemoteId: 'lead@exemplo.com',
        text: 'ok',
        email: { threadSubject: 'Re: Orçamento da cozinha' },
      },
      canal,
    );
    // Não empilha "Re: Re:".
    expect(provider.sent[0]?.input.subject).toBe('Re: Orçamento da cozinha');
  });

  it('conversa sai sempre no fluxo transacional', async () => {
    // Misturar com broadcast derrubaria a entrega do domínio do cliente.
    const { adapter: a, provider } = adapter();
    await a.sendText({ contactRemoteId: 'lead@exemplo.com', text: 'oi' }, canal);
    expect(provider.sent[0]?.input.stream).toBe('transactional');
  });

  it('monta o encadeamento a partir do que está sendo respondido', async () => {
    const { adapter: a, provider } = adapter();
    await a.sendText(
      {
        contactRemoteId: 'lead@exemplo.com',
        text: 'respondendo',
        replyToExternalId: '<r1@cliente.com>',
        email: { references: ['<raiz@x>'] },
      },
      canal,
    );
    expect(provider.sent[0]?.input.inReplyTo).toBe('r1@cliente.com');
    expect(provider.sent[0]?.input.references).toEqual(['raiz@x', 'r1@cliente.com']);
  });

  it('canal sem remetente recusa antes de tocar o provedor', async () => {
    const { adapter: a, provider } = adapter();
    const r = await a.sendText(
      { contactRemoteId: 'lead@exemplo.com', text: 'oi' },
      { ...canal, emailFrom: undefined },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('EMAIL_NO_SENDER');
    expect(provider.sent).toHaveLength(0);
  });

  it('erro do provedor vira SendResult de erro, não exceção', async () => {
    const { adapter: a } = adapter(
      new FakeEmailProvider({ failWith: { errorCode: 'rate_limited', errorMessage: 'devagar' } }),
    );
    const r = await a.sendText({ contactRemoteId: 'lead@exemplo.com', text: 'oi' }, canal);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('rate_limited');
  });
});

describe('mídia', () => {
  it('manda a legenda e o link no corpo', async () => {
    const { adapter: a, provider } = adapter();
    await a.sendMedia(
      {
        contactRemoteId: 'lead@exemplo.com',
        mediaKind: 'image',
        publicMediaUrl: 'https://r2.exemplo/foto.jpg',
        mime: 'image/jpeg',
        caption: 'Antes e depois',
      },
      canal,
    );
    expect(provider.sent[0]?.input.text).toContain('Antes e depois');
    expect(provider.sent[0]?.input.text).toContain('https://r2.exemplo/foto.jpg');
  });
});

describe('o que e-mail não faz, ele recusa explicitamente', () => {
  it('modelo aprovado é conceito do WhatsApp', async () => {
    const { adapter: a } = adapter();
    const r = await a.sendTemplate(
      {
        contactRemoteId: 'lead@exemplo.com',
        templateName: 'x',
        languageCode: 'pt_BR',
        components: [],
      },
      canal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('EMAIL_UNSUPPORTED');
  });

  it('interativo não existe em e-mail', async () => {
    const { adapter: a } = adapter();
    const r = await a.sendInteractive();
    expect(r.ok).toBe(false);
  });

  it('download por referência é bug de quem chamou — anexo vem no webhook', async () => {
    const { adapter: a } = adapter();
    await expect(a.downloadMedia()).rejects.toThrow(/webhook/i);
  });

  it('leitura e presença são no-op silencioso', async () => {
    const { adapter: a } = adapter();
    await expect(a.markAsRead()).resolves.toBeUndefined();
    await expect(a.sendTypingIndicator()).resolves.toBeUndefined();
  });
});

describe('inbound', () => {
  it('converte e-mail recebido em evento de mensagem com o encadeamento', async () => {
    const { adapter: a } = adapter();
    const eventos = await a.parseInbound(
      {
        messageId: '<r2@cliente.com>',
        from: 'lead@exemplo.com',
        to: ['orcamento@sunrise.com'],
        subject: 'Re: Orçamento da cozinha',
        text: 'quanto fica com porcelanato?',
        inReplyTo: '<r1@x>',
        references: '<raiz@x> <r1@x>',
      },
      canal,
    );

    expect(eventos).toHaveLength(1);
    const e = eventos[0];
    expect(e?.type).toBe('message');
    expect(e?.provider).toBe('email');
    if (e?.type === 'message') {
      expect(e.contactRemoteId).toBe('lead@exemplo.com');
      expect(e.externalId).toBe('r2@cliente.com');
      expect(e.metadata?.['references']).toEqual(['raiz@x', 'r1@x']);
      expect(e.metadata?.['subject']).toBe('Re: Orçamento da cozinha');
    }
  });

  it('payload que não é e-mail devolve lista vazia, sem lançar', async () => {
    const { adapter: a } = adapter();
    expect(await a.parseInbound({ lixo: true }, canal)).toEqual([]);
    expect(await a.parseInbound(null, canal)).toEqual([]);
  });
});

describe('capacidades declaradas', () => {
  it('declara o que e-mail tem', () => {
    for (const c of ['subject', 'html_body', 'attachments', 'cc_bcc', 'threading'] as const) {
      expect(EMAIL_CAPABILITIES.supports(c)).toBe(true);
    }
  });

  it('NÃO declara o que é da Meta — o wizard não vai oferecer', () => {
    for (const c of [
      'approved_template_required',
      'sticker',
      'location',
      'presence',
      'segmented_text',
    ] as const) {
      expect(EMAIL_CAPABILITIES.supports(c)).toBe(false);
    }
  });

  it('tem teto de anexo e nenhuma segmentação', () => {
    expect(EMAIL_CAPABILITIES.limits.maxAttachmentBytes).toBeGreaterThan(0);
    expect(EMAIL_CAPABILITIES.limits.charactersPerSegment).toBeNull();
  });
});
