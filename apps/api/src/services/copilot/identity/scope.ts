/**
 * Escopo fino do Copiloto (ADR-003 §4): os MESMOS predicados que as telas usam.
 *
 * É o único lugar que diz o que um membro vê pelo Copiloto. Toda ferramenta de consulta
 * (S06, S07), o motor de propostas (S05, ao resolver alvos) e a sessão (S10, ao resolver o
 * contexto de página) importam daqui. Duplicar um predicado numa ferramenta é bug: os
 * caminhos divergem e o Copiloto vira oráculo do que a tela esconde.
 *
 * Convenções:
 * - Predicado `null` = sem filtro intra-tenant (o RLS do `withWorkspace` continua valendo).
 * - Sem a permissão de leitura da entidade, o predicado é `false`: nada aparece.
 * - O que o membro não vê é INEXISTENTE para ele: `resolveVisible` devolve `null` tanto para
 *   "não existe" quanto para "existe e você não vê". A ferramenta responde `not_found`,
 *   nunca "sem permissão".
 * - Os predicados referenciam as tabelas pelo nome (`"deals"`, `"conversations"`): a tabela
 *   precisa estar no FROM SEM alias.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { buildVisibilityPredicate, calendarRepo, schema, type DbTx } from '@hm/db';
import { can, type PAGE_CONTEXT_ENTITY_TYPES } from '@hm/shared';
import type { CopilotPrincipal } from './principal';

export type CopilotEntityType = (typeof PAGE_CONTEXT_ENTITY_TYPES)[number];

export interface CopilotEntityRef {
  readonly type: CopilotEntityType;
  readonly id: string;
}

/** Entidade mínima resolvida sob escopo. `label` é para o chip/contexto, nunca e-mail ou telefone. */
export interface VisibleEntity {
  readonly type: CopilotEntityType;
  readonly id: string;
  readonly label: string;
}

/** Tamanho máximo do rótulo (`page_context_resolved.label` aceita 160). */
export const VISIBLE_LABEL_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTHING: SQL = sql`false`;

function isUnrestricted(principal: CopilotPrincipal): boolean {
  return principal.role === 'OWNER' || principal.role === 'ADMIN';
}

/**
 * Conversas visíveis: `buildVisibilityPredicate` da inbox (F30: departamentos, overrides e
 * privacidade entre colegas, com `inherit` resolvido por conversa). `null` para OWNER/ADMIN.
 * Exige `conversations` no FROM.
 */
export function conversationScope(principal: CopilotPrincipal): SQL | null {
  if (!can(principal.role, 'conversation.view')) return NOTHING;
  if (isUnrestricted(principal)) return null;
  return buildVisibilityPredicate({
    memberId: principal.memberId,
    role: principal.role,
    workspaceId: principal.workspaceId,
  });
}

/**
 * Negócios visíveis. AGENT vê os seus (`owner_id = membro`) ou os que têm conversa vinculada
 * que ele vê. Os demais papéis com `pipeline.view` veem todos (`null`). Exige `deals` no FROM.
 */
export function dealScope(principal: CopilotPrincipal): SQL | null {
  if (!can(principal.role, 'pipeline.view')) return NOTHING;
  if (principal.role !== 'AGENT') return null;
  const conv = conversationScope(principal) ?? sql`true`;
  return sql`(
    ${schema.deals.ownerId} = ${principal.memberId}
    or (
      ${schema.deals.conversationId} is not null
      and exists (
        select 1 from ${schema.conversations}
         where ${schema.conversations.id} = ${schema.deals.conversationId}
           and ${conv}
      )
    )
  )`;
}

/** Contatos: `contact.view` libera o workspace inteiro; sem ela, nada. */
export function contactScope(principal: CopilotPrincipal): SQL | null {
  return can(principal.role, 'contact.view') ? null : NOTHING;
}

function clip(label: string | null | undefined, fallback: string): string {
  const trimmed = (label ?? '').trim();
  const value = trimmed.length > 0 ? trimmed : fallback;
  return value.length > VISIBLE_LABEL_MAX ? `${value.slice(0, VISIBLE_LABEL_MAX - 1)}…` : value;
}

/** `and()` que ignora predicados `null` (sem filtro). */
function scoped(...conds: (SQL | null | undefined)[]): SQL | undefined {
  return and(...conds.filter((c): c is SQL => c !== null && c !== undefined));
}

/**
 * Re-resolve um id (dos `args` ou do contexto de página) sob RLS + escopo do membro.
 * `null` = inexistente OU invisível (indistinguíveis de propósito). Id que não é UUID nem
 * chega ao banco. Uma query por chamada (duas para compromisso de quem não é OWNER/ADMIN).
 */
export async function resolveVisible(
  tx: DbTx,
  principal: CopilotPrincipal,
  ref: CopilotEntityRef,
): Promise<VisibleEntity | null> {
  if (typeof ref.id !== 'string' || !UUID_RE.test(ref.id)) return null;
  const ws = principal.workspaceId;
  const { deals, contacts, conversations, campaigns, events, pipelines, stages } = schema;

  switch (ref.type) {
    case 'deal': {
      const [row] = await tx
        .select({ id: deals.id, label: deals.title })
        .from(deals)
        .where(scoped(eq(deals.id, ref.id), eq(deals.workspaceId, ws), dealScope(principal)))
        .limit(1);
      return row ? { type: 'deal', id: row.id, label: clip(row.label, 'Negócio') } : null;
    }
    case 'contact': {
      const [row] = await tx
        .select({ id: contacts.id, name: contacts.displayName, profile: contacts.profileName })
        .from(contacts)
        .where(
          scoped(eq(contacts.id, ref.id), eq(contacts.workspaceId, ws), contactScope(principal)),
        )
        .limit(1);
      // Sem nome: rótulo genérico. Nunca o telefone ou o e-mail como rótulo.
      return row
        ? { type: 'contact', id: row.id, label: clip(row.name ?? row.profile, 'Contato sem nome') }
        : null;
    }
    case 'conversation': {
      const [row] = await tx
        .select({
          id: conversations.id,
          name: contacts.displayName,
          profile: contacts.profileName,
        })
        .from(conversations)
        .leftJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(
          scoped(
            eq(conversations.id, ref.id),
            eq(conversations.workspaceId, ws),
            conversationScope(principal),
          ),
        )
        .limit(1);
      return row
        ? {
            type: 'conversation',
            id: row.id,
            label: clip(row.name ?? row.profile, 'Conversa'),
          }
        : null;
    }
    case 'campaign': {
      if (!can(principal.role, 'campaign.list')) return null;
      const [row] = await tx
        .select({ id: campaigns.id, label: campaigns.name })
        .from(campaigns)
        .where(and(eq(campaigns.id, ref.id), eq(campaigns.workspaceId, ws)))
        .limit(1);
      return row ? { type: 'campaign', id: row.id, label: clip(row.label, 'Campanha') } : null;
    }
    case 'event': {
      if (!can(principal.role, 'calendar.view')) return null;
      const [row] = await tx
        .select({ id: events.id, label: events.title, calendarId: events.calendarId })
        .from(events)
        .where(and(eq(events.id, ref.id), eq(events.workspaceId, ws)))
        .limit(1);
      if (!row) return null;
      // Mesma régua da agenda (CALENDAR.md §8): calendário pessoal/de time só para quem acessa.
      if (!isUnrestricted(principal)) {
        const accessible = await calendarRepo.accessibleCalendarIds(tx, {
          memberId: principal.memberId,
          role: principal.role,
        });
        if (!accessible.includes(row.calendarId)) return null;
      }
      return { type: 'event', id: row.id, label: clip(row.label, 'Compromisso') };
    }
    case 'pipeline': {
      if (!can(principal.role, 'pipeline.view')) return null;
      const [row] = await tx
        .select({ id: pipelines.id, label: pipelines.name })
        .from(pipelines)
        .where(and(eq(pipelines.id, ref.id), eq(pipelines.workspaceId, ws)))
        .limit(1);
      return row ? { type: 'pipeline', id: row.id, label: clip(row.label, 'Pipeline') } : null;
    }
    case 'stage': {
      if (!can(principal.role, 'pipeline.view')) return null;
      const [row] = await tx
        .select({ id: stages.id, label: stages.name })
        .from(stages)
        .where(and(eq(stages.id, ref.id), eq(stages.workspaceId, ws)))
        .limit(1);
      return row ? { type: 'stage', id: row.id, label: clip(row.label, 'Estágio') } : null;
    }
  }
}
