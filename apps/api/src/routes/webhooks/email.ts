/**
 * Webhook de e-mail: recebimento e retorno (F60-S08 — CANAIS_PLAN §4).
 *
 * Duas rotas, dois riscos diferentes:
 *
 * - `POST /webhooks/email/inbound` — o corpo é escrito por um desconhecido e vai
 *   parar na inbox de um atendente logado. O HTML é sanitizado antes de sair
 *   daqui (`sanitizeEmailHtml`, lista de permissão).
 * - `POST /webhooks/email/events` — decide **supressão de contato**. Sem
 *   assinatura verificada, qualquer um forja um `hard_bounce` e apaga o cliente
 *   de um workspace do funil sem ninguém perceber.
 *
 * Corpo BRUTO, como nas rotas Meta e AbacatePay: a assinatura é sobre os bytes
 * exatos, e o `express.json()` global consumiria o stream. Por isso este router
 * é montado ANTES do json — ver o cabeçalho de `webhooks/index.ts`.
 */
import express, { Router, type Request, type Response } from 'express';
import {
  FakeEmailProvider,
  decideOnEmailEvent,
  htmlToText,
  sanitizeEmailHtml,
  type IEmailProvider,
  type InboundEmail,
} from '@hm/channels';
import { rateLimit } from '../../middlewares/rate-limit';

/** Payload já normalizado, pronto para o pipeline inbound. */
export interface NormalizedInboundEmail {
  readonly messageId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  /** Texto puro, para prévia e busca. */
  readonly text: string;
  /** HTML **já sanitizado**. Nunca o original. */
  readonly html: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly receivedAt: string;
}

/**
 * Normaliza e **sanitiza**. É aqui que o HTML de terceiro deixa de ser perigoso,
 * e por isso a função é exportada: o teste bate nela direto.
 */
export function normalizeInbound(email: InboundEmail): NormalizedInboundEmail {
  const htmlSeguro = sanitizeEmailHtml(email.html);
  return {
    messageId: email.messageId,
    from: email.from.email,
    to: email.to.map((t) => t.email),
    subject: email.subject,
    // Texto: o que o provedor mandou, ou o extraído do HTML já limpo. Nunca o
    // HTML cru — a prévia da conversa também é superfície de renderização.
    text: email.text.trim().length > 0 ? email.text : htmlToText(htmlSeguro),
    html: htmlSeguro,
    inReplyTo: email.inReplyTo,
    references: email.references,
    receivedAt: email.receivedAt.toISOString(),
  };
}

export interface EmailWebhookDeps {
  readonly provider: IEmailProvider;
  /** Entrega o e-mail normalizado ao pipeline. Injetável para teste. */
  readonly onInbound: (email: NormalizedInboundEmail) => Promise<void>;
  /**
   * Aplica a decisão de um evento de retorno (suprimir, registrar, ignorar).
   * Recebe a contagem atual de falhas transitórias e devolve a nova.
   */
  readonly onEvent: (input: {
    readonly recipient: string;
    readonly messageId: string;
    readonly kind: string;
    readonly action: 'suppress' | 'record' | 'none';
    readonly reason: string;
  }) => Promise<void>;
  /** Falhas transitórias já acumuladas para o endereço. */
  readonly softBounceCount?: (recipient: string) => Promise<number>;
}

function headersOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

export function createEmailWebhookRouter(deps: EmailWebhookDeps): Router {
  const router = Router();
  const raw = express.raw({ type: '*/*', limit: '10mb' });

  // Webhook público: mesmo teto dos demais. Sem isso, um provedor com defeito
  // (ou alguém apontando tráfego para cá) derruba a API inteira.
  const limite = rateLimit({ bucket: 'webhook-email', max: 600, windowSec: 60, byEmail: false });

  router.post(
    '/webhooks/email/inbound',
    limite,
    raw,
    async (req: Request, res: Response): Promise<void> => {
      const corpo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

      if (!deps.provider.verifyWebhook(corpo, headersOf(req))) {
        // 403 sem detalhe: dizer o que faltou ajuda quem está tentando forjar.
        res.status(403).json({ message: 'Assinatura inválida.' });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(corpo);
      } catch {
        res.status(400).json({ message: 'Corpo inválido.' });
        return;
      }

      const email = deps.provider.parseInbound(payload);
      if (email === null) {
        // Assinado mas irreconhecível: 200 de propósito. Devolver erro faria o
        // provedor reenviar para sempre um payload que nunca vamos entender.
        res.status(200).json({ ignored: true });
        return;
      }

      await deps.onInbound(normalizeInbound(email));
      res.status(200).json({ ok: true });
    },
  );

  router.post(
    '/webhooks/email/events',
    limite,
    raw,
    async (req: Request, res: Response): Promise<void> => {
      const corpo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

      if (!deps.provider.verifyWebhook(corpo, headersOf(req))) {
        res.status(403).json({ message: 'Assinatura inválida.' });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(corpo);
      } catch {
        res.status(400).json({ message: 'Corpo inválido.' });
        return;
      }

      const eventos = deps.provider.parseEvents(payload);
      for (const evento of eventos) {
        const anteriores = deps.softBounceCount
          ? await deps.softBounceCount(evento.recipient)
          : 0;
        const decisao = decideOnEmailEvent(evento, anteriores);
        await deps.onEvent({
          recipient: evento.recipient,
          messageId: evento.messageId,
          kind: evento.kind,
          action: decisao.action,
          reason: decisao.reason,
        });
      }

      res.status(200).json({ processed: eventos.length });
    },
  );

  return router;
}

/**
 * Router com provedor inerte, para a composição atual.
 *
 * O `FakeEmailProvider` **sem segredo recusa toda assinatura**, então as duas
 * rotas respondem 403 até a F60-S04 injetar o provedor real. Isso é deliberado:
 * uma rota de webhook aberta é pior que uma rota que não funciona.
 */
export function createInertEmailWebhookRouter(): Router {
  return createEmailWebhookRouter({
    provider: new FakeEmailProvider(),
    onInbound: async () => undefined,
    onEvent: async () => undefined,
  });
}
