/**
 * Janela de envio 24h por provider (F1-S17).
 *
 * Regra de negócio (LIVECHAT.md / INSTAGRAM.md §6):
 *  - meta_whatsapp: janela de atendimento de 24h a partir da última mensagem
 *    INBOUND do contato. Fora dela o envio de free-form é bloqueado e só um
 *    template (HSM) reabre a conversa → `requiresTemplate: true`.
 *  - meta_instagram: janela padrão de 24h. Fora dela ainda é possível enviar
 *    com a tag HUMAN_AGENT (janela estendida de 7 dias) → `messageTag` é
 *    devolvido para a UI exibir o banner "Human Agent Tag" e o backend logar
 *    o uso da tag em audit_logs no envio.
 *  - waha: sem janela imposta pela plataforma → sempre aberta.
 *
 * Este router NÃO é montado aqui: `createApp` deve fazer
 * `app.use(createWindowRouter())` após `express.json` (ver relatório do slot).
 */
import { Router, type Request, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { IgMessageTag } from '@hm/channels';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Provider técnico do canal (espelha channels_provider_chk). */
type Provider = 'meta_whatsapp' | 'meta_instagram' | 'waha';

/** Janela em milissegundos (24h) usada por WhatsApp e Instagram. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Estado da janela de envio devolvido à UI. O composer usa para liberar o
 * envio, bloquear com CTA de template (WA) ou exibir o banner de tag (IG).
 */
export interface WindowState {
  provider: Provider;
  /** `true` quando o agente pode enviar free-form sem template/tag. */
  isOpen: boolean;
  /** ISO da expiração da janela; `null` quando não há inbound ou não se aplica (WAHA). */
  expiresAt: string | null;
  /** WhatsApp fora da janela: só um template reabre a conversa. */
  requiresTemplate: boolean;
  /**
   * Instagram fora da janela: tag exigida para enviar (HUMAN_AGENT).
   * `null` quando dentro da janela ou provider sem tags. Quando != null, o
   * envio DEVE registrar audit_logs (regra obrigatória do slot).
   */
  messageTag: IgMessageTag | null;
}

function computeWindow(
  provider: Provider,
  lastInboundAt: Date | null,
  now: Date,
): WindowState {
  if (provider === 'waha') {
    return { provider, isOpen: true, expiresAt: null, requiresTemplate: false, messageTag: null };
  }

  // Sem inbound registrado: a janela nunca foi aberta pelo contato.
  if (!lastInboundAt) {
    if (provider === 'meta_whatsapp') {
      return { provider, isOpen: false, expiresAt: null, requiresTemplate: true, messageTag: null };
    }
    // meta_instagram
    return {
      provider,
      isOpen: false,
      expiresAt: null,
      requiresTemplate: false,
      messageTag: 'HUMAN_AGENT',
    };
  }

  const expiresAtMs = lastInboundAt.getTime() + WINDOW_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const isOpen = now.getTime() < expiresAtMs;

  if (isOpen) {
    return { provider, isOpen: true, expiresAt, requiresTemplate: false, messageTag: null };
  }

  if (provider === 'meta_whatsapp') {
    return { provider, isOpen: false, expiresAt, requiresTemplate: true, messageTag: null };
  }
  // meta_instagram fora da janela: tag HUMAN_AGENT habilita o envio estendido.
  return { provider, isOpen: false, expiresAt, requiresTemplate: false, messageTag: 'HUMAN_AGENT' };
}

function isProvider(value: string): value is Provider {
  return value === 'meta_whatsapp' || value === 'meta_instagram' || value === 'waha';
}

/**
 * Router da janela de envio. Exporta um factory (padrão dos demais routers)
 * para ser montado por `createApp` — não monta a si mesmo.
 */
export function createWindowRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('conversation.view')] as const;

  // GET /api/conversations/:id/window — estado da janela 24h para o composer.
  router.get(
    '/api/conversations/:id/window',
    ...guard,
    async (req: Request, res: Response): Promise<void> => {
      const rawId = req.params['id'];
      const conversationId = typeof rawId === 'string' ? rawId : '';
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }

      const result = await req.scoped!(async (tx) => {
        // Provider vem do canal da conversa (RLS-escopado por workspace).
        const [conv] = await tx
          .select({ provider: schema.channels.provider })
          .from(schema.conversations)
          .innerJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);

        if (!conv) return null;

        // Última mensagem INBOUND define a abertura da janela.
        const [lastInbound] = await tx
          .select({ createdAt: schema.messages.createdAt })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, conversationId),
              eq(schema.messages.direction, 'inbound'),
            ),
          )
          .orderBy(desc(schema.messages.createdAt))
          .limit(1);

        return { provider: conv.provider, lastInboundAt: lastInbound?.createdAt ?? null };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if (!isProvider(result.provider)) {
        res.status(422).json({ message: 'Provider de canal não suportado.' });
        return;
      }

      const state = computeWindow(result.provider, result.lastInboundAt, new Date());
      res.json({ window: state });
    },
  );

  return router;
}
