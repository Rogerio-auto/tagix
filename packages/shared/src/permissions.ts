/**
 * Roles + matriz de permissões (PERMISSIONS.md §1, §2, §3.1).
 * Fonte única usada no backend (`requireRole`) e no frontend (esconder UI).
 *
 * Notas: condições "(das suas)" / "(do dept)" são escopo de SERVICE LAYER — aqui
 * o role é considerado autorizado à AÇÃO; o filtro fino (linhas que ele vê) é
 * aplicado no service/SQL + RLS. `is_platform_admin` é flag ortogonal (super-admin).
 */

export const ROLES = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'] as const;
export type Role = (typeof ROLES)[number];

const ALL = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'] as const;
const STAFF = ['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT'] as const; // todos menos READONLY
const ADMINS = ['OWNER', 'ADMIN'] as const;
const MANAGERS = ['OWNER', 'ADMIN', 'SUPERVISOR'] as const;
const OWNER_ONLY = ['OWNER'] as const;

export const ROLE_CAN = {
  // §2.1 Conversações
  'conversation.view': ALL,
  'conversation.assign': STAFF,
  'conversation.transfer': STAFF,
  'conversation.resolve': STAFF,
  'conversation.snooze': STAFF,
  'conversation.toggle_ai': STAFF,
  // Nome canônico F30 (PERMISSIONS §2.1) — `toggle_ai` mantido por compat.
  'conversation.ai_mode': STAFF,
  // F34-S04 (D4): troca manual do agente de IA que atende a conversa. AÇÃO liberada
  // a OWNER/ADMIN/SUPERVISOR em qualquer conversa visível e ao AGENT (escopo fino
  // "só nas suas" aplicado no service layer, igual ai_mode/resolve). READONLY nunca.
  // TODO(F34-S07): consolidar em docs/features/PERMISSIONS.md §2.
  'conversation.assign_agent': STAFF,
  'conversation.delete_message': ADMINS,
  'conversation.export': ['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'],

  // §2.2 Contatos / Pipeline / Deals
  'contact.view': ALL,
  'contact.edit': STAFF,
  'contact.delete': ADMINS,
  'pipeline.view': ALL,
  'pipeline.edit': ADMINS,
  // §2.2 Catálogo de produtos (COCKPIT_CLIENT_ENRICHMENT §2.2): leitura ampla
  // (todos vinculam produto no cockpit); gestão do catálogo é de admin (settings).
  'product.view': ALL,
  'product.edit': ADMINS,
  'deal.move': STAFF,
  'deal.edit': STAFF,
  'deal.convert': STAFF,
  'deal.cancel_conversion': STAFF,

  // §2.3 Agentes IA / Tools / KB
  'agent.list': ALL,
  'agent.edit': ADMINS,
  'agent.toggle_tools': ADMINS,
  'agent.playground': STAFF,
  'agent.view_logs': ['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'],
  'agent.view_costs': ['OWNER', 'ADMIN', 'READONLY'],
  'agent.set_model': ADMINS,
  'kb.edit': MANAGERS,
  'kb.delete': ADMINS,

  // §2.4 Flow Builder
  'flow.list': ALL,
  'flow.edit': ADMINS,
  'flow.publish': ADMINS,
  'flow.trigger': STAFF,
  'flow.cancel': STAFF,
  'flow.view_logs': ALL,
  // Backup/restauração (export/import) — pode conter URLs/headers sensíveis e muta dados.
  'flow.backup': ADMINS,

  // §2.5 Campanhas
  'campaign.list': ['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'],
  'campaign.edit': MANAGERS,
  'campaign.activate': ADMINS,
  'campaign.pause': MANAGERS,
  'campaign.cancel': ADMINS,
  'campaign.upload_recipients': MANAGERS,
  'campaign.bulk_optin': ADMINS,
  'campaign.view_metrics': ['OWNER', 'ADMIN', 'SUPERVISOR', 'READONLY'],

  // §2.x Calendar (CALENDAR.md §8) — ownership fino (calendar pessoal vs team) e
  // resolvido no service layer; aqui so a AÇÃO. view=todos; manage (criar/editar/
  // remover calendar) = MANAGERS; availability/event.edit = STAFF (dono mexe na
  // propria agenda; READONLY nao agenda).
  'calendar.view': ALL,
  'calendar.manage': MANAGERS,
  'availability.edit': STAFF,
  'event.edit': STAFF,

  // §2.6 Canais / Workspace settings
  'channel.connect': ADMINS,
  'channel.disable': ADMINS,
  'channel.delete': OWNER_ONLY,
  'workspace.edit': ADMINS,
  'member.invite': ADMINS,
  'member.promote': ADMINS,
  'member.remove': ADMINS,
  'department.edit': ADMINS,
  'team.edit': MANAGERS,
  // F30 / LIVECHAT_OPS §5: gestão da política de visibilidade da inbox.
  'inbox.visibility.manage': ADMINS,

  // §2.7 Billing e exclusão de workspace
  'billing.view': ADMINS,
  'billing.change_plan': OWNER_ONLY,
  'billing.payment_method': OWNER_ONLY,
  'billing.cancel': OWNER_ONLY,
  'workspace.delete': OWNER_ONLY,

  // §2.8 API keys e webhooks outbound (Settings → Dev, F9)
  'apikey.list': ADMINS,
  'apikey.create': ADMINS,
  'apikey.revoke': ADMINS,
  'webhook.view': ADMINS,
  'webhook.edit': ADMINS,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof ROLE_CAN;

/** Autoriza `role` para `perm`. Usar em requireRole (backend) e p/ esconder UI (frontend). */
export function can(role: Role, perm: Permission): boolean {
  return (ROLE_CAN[perm] as readonly Role[]).includes(role);
}
