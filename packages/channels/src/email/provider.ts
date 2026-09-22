/**
 * `IEmailProvider` — contrato do provedor de e-mail (F60-S03 — CANAIS_PLAN §4).
 *
 * O adapter de canal não fala HTTP com ninguém: fala com esta interface. É o
 * mesmo padrão de `IStorageDriver` e `IAuthProvider`, e existe por dois motivos
 * concretos, não por gosto de abstração:
 *
 * 1. **Teste sem rede.** O `FakeEmailProvider` deste módulo cobre envio, retorno
 *    e encadeamento sem credencial nenhuma.
 * 2. **Trocar provedor sem reescrever o canal.** O plano separa e-mail
 *    transacional de marketing justamente porque campanha ruim não pode derrubar
 *    confirmação de agendamento — e é plausível que os dois acabem em provedores
 *    diferentes, por custo. A interface é o que torna isso barato.
 */

/** Endereço com nome de exibição opcional. */
export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

/** Anexo de saída. O binário já vem resolvido por quem chama. */
export interface EmailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
  /** Preenchido quando o anexo é referenciado no corpo HTML por `cid:`. */
  readonly contentId?: string;
}

/**
 * Fluxo de envio. Separar não é organização — é proteção de reputação: volume de
 * marketing com engajamento baixo derruba a entrega do domínio, e a confirmação
 * de agendamento é a última coisa que pode parar de chegar.
 */
export type EmailStream = 'transactional' | 'broadcast';

export interface SendEmailInput {
  readonly stream: EmailStream;
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly bcc?: readonly EmailAddress[];
  readonly replyTo?: EmailAddress;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly attachments?: readonly EmailAttachment[];
  /**
   * Encadeamento. `inReplyTo` é o `Message-ID` da mensagem respondida e
   * `references` é a cadeia completa — os dois são necessários: alguns clientes
   * de e-mail usam um, outros usam o outro.
   */
  readonly inReplyTo?: string;
  readonly references?: readonly string[];
  /**
   * URL de descadastro de um clique (`List-Unsubscribe` + `-Post`). Obrigatória
   * em `broadcast`: provedores grandes exigem na prática, e é a forma mais barata
   * de honrar revogação.
   */
  readonly listUnsubscribeUrl?: string;
  /** Correlação com a mensagem persistida, devolvida nos webhooks de retorno. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export type SendEmailResult =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly errorCode: string; readonly errorMessage: string };

/** Um e-mail recebido, já normalizado a partir do MIME. */
export interface InboundEmail {
  readonly messageId: string;
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly receivedAt: Date;
  readonly attachments: readonly EmailAttachment[];
}

/** Tipos de retorno assíncrono que mudam o estado da mensagem ou suprimem o contato. */
export type EmailEventKind =
  | 'delivered'
  | 'hard_bounce'
  | 'soft_bounce'
  | 'complaint'
  | 'opened'
  | 'clicked';

export interface EmailEvent {
  readonly kind: EmailEventKind;
  readonly messageId: string;
  readonly recipient: string;
  readonly occurredAt: Date;
  readonly detail?: string;
}

export interface IEmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
  /** Converte o payload bruto do webhook de inbound num `InboundEmail`. */
  parseInbound(payload: unknown): InboundEmail | null;
  /** Converte o payload bruto do webhook de retorno em eventos. */
  parseEvents(payload: unknown): readonly EmailEvent[];
  /**
   * Verifica a assinatura do webhook. Recusar payload não assinado é o que
   * impede alguém de forjar um `hard_bounce` e suprimir o contato de um cliente.
   */
  verifyWebhook(rawBody: string, headers: Readonly<Record<string, string>>): boolean;
}
