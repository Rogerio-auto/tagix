/**
 * Provedor de e-mail em memória (F60-S03).
 *
 * Existe para que o canal inteiro — envio, encadeamento, retorno, supressão por
 * bounce — seja testável **sem credencial e sem rede**. Não é mock de teste
 * jogado num arquivo `__mocks__`: é uma implementação de verdade do contrato, com
 * as mesmas regras de validação, e por isso mora no código de produção.
 *
 * Também serve de referência executável para quem for escrever o adapter real: o
 * que este faz é o mínimo que o provedor precisa entregar.
 */
import {
  type EmailEvent,
  type IEmailProvider,
  type InboundEmail,
  type SendEmailInput,
  type SendEmailResult,
} from './provider';
import { normalizeMessageId, parseReferences } from './threading';

export interface SentEmail {
  readonly input: SendEmailInput;
  readonly messageId: string;
  readonly sentAt: Date;
}

/** Formato mínimo de um inbound simulado (espelha o que provedores entregam). */
interface RawInbound {
  messageId?: unknown;
  from?: unknown;
  fromName?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
  receivedAt?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export interface FakeEmailProviderOptions {
  /** Força falha de envio, para exercitar o caminho de erro. */
  readonly failWith?: { readonly errorCode: string; readonly errorMessage: string };
  /** Assinatura esperada no header `x-signature`. */
  readonly webhookSecret?: string;
}

export class FakeEmailProvider implements IEmailProvider {
  readonly name = 'fake';
  private readonly enviados: SentEmail[] = [];
  private contador = 0;

  constructor(private readonly options: FakeEmailProviderOptions = {}) {}

  /** Tudo que foi enviado, na ordem. */
  get sent(): readonly SentEmail[] {
    return this.enviados;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.options.failWith) {
      return { ok: false, ...this.options.failWith };
    }

    // As validações abaixo existem no provedor real como erro de API; replicá-las
    // aqui é o que faz o teste pegar o problema antes de gastar uma chamada.
    if (input.to.length === 0) {
      return { ok: false, errorCode: 'no_recipient', errorMessage: 'Nenhum destinatário.' };
    }
    if (input.subject.trim().length === 0) {
      return { ok: false, errorCode: 'empty_subject', errorMessage: 'Assunto vazio.' };
    }
    if (input.stream === 'broadcast' && input.listUnsubscribeUrl === undefined) {
      // Provedores grandes exigem `List-Unsubscribe` em envio de massa, e é a
      // forma mais barata de honrar revogação. Falhar aqui é melhor que entregar
      // no spam e descobrir depois.
      return {
        ok: false,
        errorCode: 'missing_list_unsubscribe',
        errorMessage: 'Envio broadcast exige URL de descadastro de um clique.',
      };
    }

    this.contador += 1;
    const messageId = `fake-${this.contador}@tagix.test`;
    this.enviados.push({ input, messageId, sentAt: new Date() });
    return { ok: true, messageId };
  }

  parseInbound(payload: unknown): InboundEmail | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const raw = payload as RawInbound;

    const messageId = str(raw.messageId);
    const from = str(raw.from);
    if (messageId === null || from === null) return null;

    const to = Array.isArray(raw.to)
      ? raw.to.filter((t): t is string => typeof t === 'string').map((email) => ({ email }))
      : [];

    const receivedAt =
      typeof raw.receivedAt === 'string' ? new Date(raw.receivedAt) : new Date();

    return {
      messageId: normalizeMessageId(messageId),
      from: { email: from, ...(str(raw.fromName) ? { name: str(raw.fromName) as string } : {}) },
      to,
      subject: str(raw.subject) ?? '',
      text: typeof raw.text === 'string' ? raw.text : '',
      html: typeof raw.html === 'string' ? raw.html : null,
      inReplyTo: str(raw.inReplyTo) === null ? null : normalizeMessageId(str(raw.inReplyTo) as string),
      references: parseReferences(typeof raw.references === 'string' ? raw.references : null),
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      attachments: [],
    };
  }

  parseEvents(payload: unknown): readonly EmailEvent[] {
    if (!Array.isArray(payload)) return [];
    const eventos: EmailEvent[] = [];
    for (const item of payload) {
      if (typeof item !== 'object' || item === null) continue;
      const e = item as Record<string, unknown>;
      const kind = e['kind'];
      const messageId = str(e['messageId']);
      const recipient = str(e['recipient']);
      if (typeof kind !== 'string' || messageId === null || recipient === null) continue;
      if (
        kind !== 'delivered' &&
        kind !== 'hard_bounce' &&
        kind !== 'soft_bounce' &&
        kind !== 'complaint' &&
        kind !== 'opened' &&
        kind !== 'clicked'
      ) {
        continue;
      }
      eventos.push({
        kind,
        messageId: normalizeMessageId(messageId),
        recipient,
        occurredAt: typeof e['occurredAt'] === 'string' ? new Date(e['occurredAt']) : new Date(),
        ...(str(e['detail']) ? { detail: str(e['detail']) as string } : {}),
      });
    }
    return eventos;
  }

  verifyWebhook(_rawBody: string, headers: Readonly<Record<string, string>>): boolean {
    // Sem segredo configurado, recusa tudo. O default seguro importa: aceitar
    // payload não assinado deixaria alguém forjar um `hard_bounce` e suprimir o
    // contato de um cliente.
    const esperado = this.options.webhookSecret;
    if (esperado === undefined) return false;
    return headers['x-signature'] === esperado;
  }
}
