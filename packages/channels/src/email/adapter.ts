/**
 * `EmailChannelAdapter` — e-mail como canal da inbox (F60-S03 — CANAIS_PLAN §4).
 *
 * Implementa o mesmo `IChannelAdapter` dos canais Meta, para que o worker
 * outbound, o portão de consentimento e o composer não precisem saber que e-mail
 * é diferente. O que é diferente fica aqui dentro.
 *
 * Três coisas que este adapter faz e os outros não precisam:
 *
 * 1. **Assunto.** O contrato comum nasceu para mensageria e não tem assunto. Ele
 *    entra por `input.email` (`EmailSendOptions`), um campo tipado e opcional,
 *    específico do canal — em vez de espalhar `subject?` no contrato que todo
 *    adapter carrega. Quando não vem, é derivado. Ver `subjectFor`.
 * 2. **Encadeamento.** `In-Reply-To` e `References` vêm de `replyToExternalId`,
 *    que no e-mail é o `Message-ID` da mensagem respondida.
 * 3. **Fluxo.** Conversa é sempre `transactional`. Campanha usa `broadcast` e
 *    passa por outro caminho — separar protege a reputação do domínio.
 */
import { declareCapabilities, type DeclaredCapabilities } from '../capabilities';
import type {
  AdapterCapabilities,
  Channel,
  EmailSendOptions,
  IChannelAdapter,
  InboundEvent,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
} from '../types';
import type { IEmailProvider, SendEmailInput } from './provider';
import { buildReferences, normalizeMessageId, replySubject } from './threading';

/** Resultado de erro padronizado para o que o e-mail não faz. */
function unsupported(what: string): SendResult {
  return {
    ok: false,
    errorCode: 'EMAIL_UNSUPPORTED',
    errorMessage: `E-mail não suporta ${what}.`,
  };
}

/**
 * Capacidades do canal, no vocabulário da F60-S01.
 *
 * Note o que **não** está aqui: `approved_template_required`, `sticker`,
 * `location`, `presence`. O wizard de campanha e o composer leem isto e não
 * oferecem o que o canal não faz.
 */
export const EMAIL_CAPABILITIES: DeclaredCapabilities = declareCapabilities(
  ['subject', 'html_body', 'attachments', 'cc_bcc', 'threading', 'media'],
  {
    charactersPerSegment: null,
    maxSegments: null,
    // Teto conservador: provedores variam entre 10 e 25 MB no total da mensagem,
    // e o binário cresce ~33% em base64. Verificar o limite real do provedor
    // escolhido antes de subir este número.
    maxAttachmentBytes: 10 * 1024 * 1024,
  },
);

/** Contrato antigo, preenchido com `false` no que é da Meta. */
const LEGACY_CAPABILITIES: AdapterCapabilities = {
  templatesHSM: false,
  storyMentions: false,
  storyReplies: false,
  publicComments: false,
  messageTags: false,
  voicePtt: false,
  sticker: false,
  location: false,
};

export interface EmailAdapterOptions {
  /**
   * Assunto usado quando a mensagem abre uma thread nova e o chamador não
   * informou nenhum. Genérico de propósito: é melhor que vazio, e o caminho
   * normal é o chamador informar.
   */
  readonly defaultSubject?: string;
}

export class EmailChannelAdapter implements IChannelAdapter {
  readonly provider = 'email' as const;
  readonly capabilities = LEGACY_CAPABILITIES;
  readonly declared = EMAIL_CAPABILITIES;

  constructor(
    private readonly emails: IEmailProvider,
    private readonly options: EmailAdapterOptions = {},
  ) {}

  /**
   * Assunto da mensagem.
   *
   * Ordem: o que o chamador declarou → resposta ao assunto da thread → padrão.
   * O assunto **não** identifica a thread (isso é `References`), mas um assunto
   * ruim faz o cliente achar que é outra conversa.
   */
  private subjectFor(email: EmailSendOptions | undefined): string {
    const declarado = email?.subject?.trim();
    if (declarado !== undefined && declarado.length > 0) return declarado;

    const anterior = email?.threadSubject?.trim();
    if (anterior !== undefined && anterior.length > 0) return replySubject(anterior);

    return this.options.defaultSubject ?? 'Mensagem';
  }

  private threadingFor(input: {
    replyToExternalId?: string;
    email?: EmailSendOptions;
  }): { inReplyTo?: string; references?: readonly string[] } {
    const id = input.replyToExternalId;
    if (id === undefined || id.trim().length === 0) return {};
    return {
      inReplyTo: normalizeMessageId(id),
      references: buildReferences(input.email?.references ?? [], id),
    };
  }

  private base(channel: Channel, to: string): Pick<SendEmailInput, 'stream' | 'from' | 'to'> {
    return {
      // Conversa é sempre transacional. Campanha usa `broadcast` e não passa por
      // aqui — misturar os dois derruba a entrega do domínio do cliente.
      stream: 'transactional',
      from: {
        email: channel.emailFrom ?? '',
        ...(channel.emailFromName ? { name: channel.emailFromName } : {}),
      },
      to: [{ email: to }],
    };
  }

  async sendText(input: SendTextInput, channel: Channel): Promise<SendResult> {
    if (!channel.emailFrom) {
      return {
        ok: false,
        errorCode: 'EMAIL_NO_SENDER',
        errorMessage: 'Canal de e-mail sem remetente configurado.',
      };
    }

    const r = await this.emails.send({
      ...this.base(channel, input.contactRemoteId),
      subject: this.subjectFor(input.email),
      text: input.text,
      ...this.threadingFor(input),
    });

    return r.ok
      ? { ok: true, externalId: r.messageId }
      : { ok: false, errorCode: r.errorCode, errorMessage: r.errorMessage };
  }

  async sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult> {
    if (!channel.emailFrom) {
      return {
        ok: false,
        errorCode: 'EMAIL_NO_SENDER',
        errorMessage: 'Canal de e-mail sem remetente configurado.',
      };
    }

    // A mídia chega como URL pública (o mesmo contrato dos canais Meta, onde o
    // provider busca o binário). Em e-mail o anexo precisa do binário, e baixá-lo
    // aqui misturaria responsabilidade. Enviamos o link no corpo e deixamos o
    // anexo de verdade para quem já tem o buffer — o worker de mídia.
    const legenda = input.caption ?? '';
    const corpo = legenda.length > 0 ? `${legenda}\n\n${input.publicMediaUrl}` : input.publicMediaUrl;

    const r = await this.emails.send({
      ...this.base(channel, input.contactRemoteId),
      subject: this.subjectFor(input.email),
      text: corpo,
      ...this.threadingFor(input),
    });

    return r.ok
      ? { ok: true, externalId: r.messageId }
      : { ok: false, errorCode: r.errorCode, errorMessage: r.errorMessage };
  }

  async sendTemplate(_input: SendTemplateInput, _channel: Channel): Promise<SendResult> {
    // Modelo aprovado é conceito do WhatsApp. Recusar explicitamente é melhor que
    // fingir suporte — mesma disciplina do `IG_NO_HSM`.
    return unsupported('modelo aprovado (isso é do WhatsApp)');
  }

  async sendInteractive(): Promise<SendResult> {
    return unsupported('botões e listas interativas');
  }

  async parseInbound(payload: unknown, _channel: Channel): Promise<InboundEvent[]> {
    const email = this.emails.parseInbound(payload);
    if (email === null) return [];

    return [
      {
        type: 'message',
        provider: 'email',
        contactRemoteId: email.from.email,
        externalId: email.messageId,
        messageType: 'text',
        content: email.text,
        rawTimestamp: String(Math.floor(email.receivedAt.getTime() / 1000)),
        metadata: {
          subject: email.subject,
          inReplyTo: email.inReplyTo,
          references: email.references,
          html: email.html,
        },
      },
    ];
  }

  async downloadMedia(): Promise<Buffer> {
    // Anexo de e-mail chega no próprio webhook, não é buscado depois por
    // referência. Se este método for chamado, é bug de quem chamou.
    throw new Error('EmailChannelAdapter: anexo chega no webhook, não há download por referência.');
  }

  async markAsRead(): Promise<void> {
    // Não existe confirmação de leitura em e-mail. O pixel de abertura é outra
    // coisa (e não é confiável), e mora no domínio de campanha.
  }

  async sendTypingIndicator(): Promise<void> {
    // Não existe presença em e-mail.
  }
}
