/**
 * Assinaturas de Web Push (F61-S03 — APP_MOBILE_PLAN.md §4.1/§4.3).
 *
 * ## Por dispositivo, não por pessoa
 *
 * A mesma pessoa tem iPhone e desktop, e às vezes um iPad na obra. Uma assinatura
 * por membro faria o aviso chegar num aparelho só — quase sempre o errado, porque
 * o último a assinar ganharia. A chave natural é o `endpoint`: o navegador gera um
 * por instalação, e ele já identifica o aparelho de forma única e global.
 *
 * Por isso o único índice de unicidade é sobre `endpoint`, e não sobre
 * `(workspace_id, member_id)`.
 *
 * ## Endpoint morto é lixo que custa
 *
 * Quando o usuário desinstala o app ou revoga a permissão, o serviço de push passa
 * a responder `404`/`410` para sempre. Sem limpeza, a base cresce com endereços
 * mortos e cada envio paga por eles em latência e cota. `failure_count` existe para
 * o caso ambíguo (erro de rede, 5xx); o caso claro — 404/410 — apaga a linha na
 * hora, porque a resposta do provedor é a fonte da verdade sobre a existência da
 * assinatura.
 *
 * ## O que NÃO fica aqui
 *
 * Nada do conteúdo notificado. Esta tabela guarda endereço e chaves de criptografia
 * — o que se manda por ela é decidido no envio, e por decisão de privacidade
 * (§4.3) nunca inclui conteúdo de mensagem de cliente.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Dono da assinatura. `cascade`: membro removido do workspace não deve
     * continuar recebendo aviso de lead — é ex-funcionário com o app no celular.
     */
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    /** URL do serviço de push do navegador. Identidade global do aparelho. */
    endpoint: text('endpoint').notNull(),
    /** Chave pública do cliente (ECDH P-256), base64url. */
    p256dh: text('p256dh').notNull(),
    /** Segredo de autenticação da assinatura, base64url. */
    auth: text('auth').notNull(),
    /**
     * Como o usuário reconhece este aparelho na lista de dispositivos ("iPhone de
     * Rogério"). Derivado do user agent no ato da assinatura; editável depois.
     */
    label: text('label'),
    userAgent: text('user_agent'),
    /**
     * Falhas ambíguas consecutivas (rede, 5xx). Zera a cada envio bem-sucedido.
     * 404/410 não incrementa: apaga.
     */
    failureCount: integer('failure_count').notNull().default(0),
    lastUsedAt: ts('last_used_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    // O endpoint é único no mundo: reassinar o mesmo aparelho ATUALIZA a linha
    // (as chaves rotacionam), nunca duplica.
    uniqueIndex('uq_push_subscriptions_endpoint').on(t.endpoint),
    // Hot path do envio: "todas as assinaturas deste membro".
    index('idx_push_subscriptions_member').on(t.workspaceId, t.memberId),
    // Faxina de assinaturas paradas há muito tempo.
    index('idx_push_subscriptions_last_used')
      .on(t.lastUsedAt)
      .where(sql`${t.lastUsedAt} is not null`),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
