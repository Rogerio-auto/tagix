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
import { assertConversationVisible, schema } from '@hm/db';
import type { IgMessageTag } from '@hm/channels';
import type { OutboundDecision, Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { checkOutboundInTx } from '../../services/consent';

/**
 * Restrição de envio do canal (F60-S02 — CANAIS_PLAN §3.3).
 *
 * A trava do composer era específica de Meta ("janela 24h"). SMS tem janela
 * horária legal, e-mail não tem janela nenhuma, e um contato suprimido não pode
 * receber por canal nenhum. A UI precisa de UM contrato que responda "posso
 * enviar agora?" e, quando não, **por quê** e **quando volta a poder**.
 *
 * `window` continua como está para não quebrar a UI atual; `restriction` é o
 * contrato novo, que combina a janela do provider com o portão da F59.
 */
export interface SendRestriction {
  canSend: boolean;
  /**
   * `provider_window` = regra do provider (Meta 24h). Os demais vêm do portão de
   * consentimento e são o enum estável de `OutboundDenyReason`.
   */
  reason:
    | 'ok'
    | 'provider_window'
    | 'suppressed'
    | 'no_consent'
    | 'quiet_hours'
    | 'registration_pending'
    | 'channel_disabled';
  /** Pronta para exibir ao atendente. */
  message: string;
  /** ISO de quando volta a poder; `null` quando não se resolve com o tempo. */
  retryAt: string | null;
}

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

/**
 * Combina a janela do provider com a decisão do portão.
 *
 * **O portão vence.** Contato suprimido não recebe nem dentro da janela de 24h —
 * a janela diz o que a Meta permite, o portão diz o que a pessoa consentiu, e
 * consentimento é o mais forte dos dois.
 */
export function toRestriction(
  state: WindowState,
  decision: OutboundDecision | null,
): SendRestriction {
  if (decision !== null && !decision.allowed) {
    return {
      canSend: false,
      reason: decision.reason,
      message: decision.message,
      retryAt: decision.retryAt?.toISOString() ?? null,
    };
  }

  if (state.isOpen) {
    return { canSend: true, reason: 'ok', message: '', retryAt: null };
  }

  // Fora da janela do provider, mas há caminho: template (WA) ou tag (IG). O
  // composer não fica bloqueado — muda de modo. `canSend: true` com motivo
  // declarado deixa a UI escolher o que oferecer.
  if (state.requiresTemplate) {
    return {
      canSend: true,
      reason: 'provider_window',
      message: 'Fora da janela de 24 horas: só um modelo aprovado reabre a conversa.',
      retryAt: null,
    };
  }
  if (state.messageTag !== null) {
    return {
      canSend: true,
      reason: 'provider_window',
      message: 'Fora da janela de 24 horas: o envio usará a tag de atendimento humano.',
      retryAt: null,
    };
  }

  return { canSend: true, reason: 'ok', message: '', retryAt: null };
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

      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;

      const result = await req.scoped!(async (tx) => {
        // Guard de visibilidade por-conversa (S07.1): nega quem não enxerga a conversa.
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return null;
        }
        // Provider vem do canal da conversa (RLS-escopado por workspace).
        const [conv] = await tx
          .select({
            provider: schema.channels.provider,
            contactId: schema.conversations.contactId,
          })
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

        return {
          provider: conv.provider,
          contactId: conv.contactId,
          lastInboundAt: lastInbound?.createdAt ?? null,
        };
      });

      if (!result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if (!isProvider(result.provider)) {
        res.status(422).json({ message: 'Provider de canal não suportado.' });
        return;
      }

      const provider = result.provider;
      const state = computeWindow(provider, result.lastInboundAt, new Date());
      const contactId = result.contactId;

      // Conversa sem contato associado (grupo, thread de comentário órfã): não há
      // consentimento a consultar. A janela do provider decide sozinha.
      if (contactId === null) {
        res.json({ window: state, restriction: toRestriction(state, null) });
        return;
      }

      // O composer é atendente humano respondendo numa conversa aberta:
      // TRANSACIONAL, sempre. Marketing sai por campanha, não por aqui.
      const decision = await req.scoped!((tx) =>
        checkOutboundInTx(tx, {
          workspaceId,
          contactId,
          channel: provider,
          purpose: 'transactional',
        }),
      );

      res.json({ window: state, restriction: toRestriction(state, decision) });
    },
  );

  return router;
}
