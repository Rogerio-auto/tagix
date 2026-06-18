/**
 * Schemas Zod da API pública v1 (F9-S03) + registry OpenAPI.
 *
 * Fonte única de verdade dos contratos: cada endpoint valida o input com estes
 * schemas e a spec OpenAPI 3.1 (`/api/v1/docs`) é GERADA a partir deles — sem
 * spec escrita à mão que possa divergir do runtime.
 *
 * `extendZodWithOpenApi` precisa rodar antes de qualquer `.openapi()`; importar este
 * módulo garante o patch (efeito colateral no topo).
 */
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** Registry compartilhado — endpoints e o gerador OpenAPI consomem o mesmo. */
export const registry = new OpenAPIRegistry();

/**
 * Scopes da API pública. Convenção `acao:recurso`. A chave (F9-S04) carrega um
 * subconjunto; `requireScope` (F9-S02) barra o que faltar.
 */
export const API_SCOPES = {
  sendMessages: 'write:messages',
  sendTemplates: 'write:templates',
  writeContacts: 'write:contacts',
  triggerFlows: 'write:flows',
  readConversations: 'read:conversations',
  // F38-S12: novos recursos da API pública.
  readContacts: 'read:contacts',
  readDeals: 'read:deals',
  writeDeals: 'write:deals',
  readConversions: 'read:conversions',
  writeConversions: 'write:conversions',
  readFlows: 'read:flows',
  readCalendar: 'read:calendar',
  writeCalendar: 'write:calendar',
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

const MAX_TEXT_LEN = 5000;

// ─── Security scheme (Bearer hm_...) ─────────────────────────────────────────
registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'hm_<token>',
  description:
    'API key do workspace no header `Authorization: Bearer hm_...`. Crie/gerencie em Settings → Dev.',
});

// ─── Erro padronizado ────────────────────────────────────────────────────────
export const errorSchema = registry.register(
  'Error',
  z
    .object({
      error: z.string().openapi({ example: 'unauthorized' }),
      message: z.string().openapi({ example: 'API key inválida, expirada ou revogada.' }),
    })
    .openapi('Error'),
);

// ─── send_message ────────────────────────────────────────────────────────────
export const sendMessageBody = registry.register(
  'SendMessageRequest',
  z
    .object({
      conversationId: z.string().uuid().openapi({ description: 'Conversa de destino (mesmo workspace da chave).' }),
      text: z.string().trim().min(1).max(MAX_TEXT_LEN).openapi({ example: 'Olá!' }),
    })
    .openapi('SendMessageRequest'),
);

export const messageResponse = registry.register(
  'MessageResponse',
  z
    .object({
      message: z.object({
        id: z.string().uuid(),
        conversationId: z.string().uuid(),
        direction: z.string(),
        viewStatus: z.string(),
        content: z.string().nullable(),
        createdAt: z.string().datetime().nullable(),
      }),
    })
    .openapi('MessageResponse'),
);

// ─── send_template ───────────────────────────────────────────────────────────
const templateComponent = z.object({
  type: z.enum(['header', 'body', 'button']),
  parameters: z.array(z.unknown()).optional(),
});

export const sendTemplateBody = registry.register(
  'SendTemplateRequest',
  z
    .object({
      conversationId: z.string().uuid(),
      templateName: z.string().trim().min(1).openapi({ example: 'order_confirmation' }),
      languageCode: z.string().trim().min(1).openapi({ example: 'pt_BR' }),
      components: z.array(templateComponent).default([]),
    })
    .openapi('SendTemplateRequest'),
);

// ─── upsert_contact ──────────────────────────────────────────────────────────
export const upsertContactBody = registry.register(
  'UpsertContactRequest',
  z
    .object({
      // Identidade de upsert: phone (preferencial) ou id explícito.
      id: z.string().uuid().optional().openapi({ description: 'Atualiza um contato específico se informado.' }),
      phone: z.string().trim().min(1).max(40).optional().openapi({ example: '+5511999990000' }),
      email: z.string().trim().email().max(200).optional(),
      displayName: z.string().trim().min(1).max(200).optional(),
      notes: z.string().trim().max(MAX_TEXT_LEN).optional(),
      language: z.string().trim().max(16).optional(),
      source: z.string().trim().max(120).optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((v) => Boolean(v.id ?? v.phone ?? v.email), {
      message: 'Informe ao menos id, phone ou email para identificar o contato.',
    })
    .openapi('UpsertContactRequest'),
);

export const contactResponse = registry.register(
  'ContactResponse',
  z
    .object({
      contact: z.object({
        id: z.string().uuid(),
        displayName: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        source: z.string().nullable(),
        createdAt: z.string().datetime().nullable(),
      }),
      created: z.boolean().openapi({ description: 'true se um novo contato foi criado; false em update.' }),
    })
    .openapi('ContactResponse'),
);

// ─── trigger_flow ────────────────────────────────────────────────────────────
export const triggerFlowBody = registry.register(
  'TriggerFlowRequest',
  z
    .object({
      flowId: z.string().uuid(),
      conversationId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      triggerData: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi('TriggerFlowRequest'),
);

export const triggerFlowResponse = registry.register(
  'TriggerFlowResponse',
  z.object({ executionId: z.string().uuid() }).openapi('TriggerFlowResponse'),
);

// ─── conversations (list + get) ──────────────────────────────────────────────
export const listConversationsQuery = z.object({
  status: z.enum(['open', 'pending', 'closed', 'resolved', 'snoozed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const conversationShape = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  status: z.string(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const conversationsListResponse = registry.register(
  'ConversationsListResponse',
  z.object({ conversations: z.array(conversationShape) }).openapi('ConversationsListResponse'),
);

export const conversationResponse = registry.register(
  'ConversationResponse',
  z.object({ conversation: conversationShape }).openapi('ConversationResponse'),
);

// ─── F38-S12: paginação comum (limit + cursor opcional) ──────────────────────
const listLimit = z.coerce.number().int().min(1).max(100).default(50);

// ─── contacts (list + get) ───────────────────────────────────────────────────
export const listContactsQuery = z.object({
  q: z.string().trim().min(1).max(200).optional().openapi({ description: 'Busca por nome/telefone/email.' }),
  limit: listLimit,
});

const contactShape = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.string().nullable(),
  language: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const contactsListResponse = registry.register(
  'ContactsListResponse',
  z.object({ contacts: z.array(contactShape) }).openapi('ContactsListResponse'),
);

export const contactGetResponse = registry.register(
  'ContactGetResponse',
  z.object({ contact: contactShape }).openapi('ContactGetResponse'),
);

// ─── send_media ──────────────────────────────────────────────────────────────
export const sendMediaBody = registry.register(
  'SendMediaRequest',
  z
    .object({
      conversationId: z.string().uuid(),
      mediaKind: z.enum(['image', 'video', 'audio', 'voice', 'document', 'sticker']),
      mediaUrl: z.string().url().openapi({ description: 'URL pública do arquivo (o provider busca o binário).' }),
      mime: z.string().trim().min(1).openapi({ example: 'image/png' }),
      caption: z.string().trim().max(MAX_TEXT_LEN).optional(),
    })
    .openapi('SendMediaRequest'),
);

// ─── deals (list + get + move) ───────────────────────────────────────────────
export const listDealsQuery = z.object({
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  limit: listLimit,
});

const dealShape = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  contactId: z.string().uuid(),
  title: z.string(),
  valueCents: z.number(),
  currency: z.string(),
  source: z.string().nullable(),
  closedAt: z.string().datetime().nullable(),
  closedWon: z.boolean().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const dealsListResponse = registry.register(
  'DealsListResponse',
  z.object({ deals: z.array(dealShape) }).openapi('DealsListResponse'),
);

export const dealGetResponse = registry.register(
  'DealGetResponse',
  z.object({ deal: dealShape }).openapi('DealGetResponse'),
);

export const moveDealBody = registry.register(
  'MoveDealRequest',
  z.object({ stageId: z.string().uuid().openapi({ description: 'Stage de destino (mesmo pipeline do deal).' }) }).openapi('MoveDealRequest'),
);

// ─── conversions (create + list) ─────────────────────────────────────────────
export const createConversionBody = registry.register(
  'CreateConversionRequest',
  z
    .object({
      conversionTypeKey: z.string().trim().min(1).openapi({ example: 'venda' }),
      contactId: z.string().uuid(),
      conversationId: z.string().uuid().optional(),
      dealId: z.string().uuid().optional(),
      valueCents: z.number().int().nonnegative().optional(),
      currency: z.string().trim().min(1).max(8).optional(),
      note: z.string().trim().max(MAX_TEXT_LEN).optional(),
    })
    .openapi('CreateConversionRequest'),
);

const conversionShape = z.object({
  id: z.string().uuid(),
  conversionTypeId: z.string().uuid(),
  contactId: z.string().uuid(),
  dealId: z.string().uuid().nullable(),
  valueCents: z.number().nullable(),
  currency: z.string(),
  source: z.string(),
  occurredAt: z.string().datetime().nullable(),
});

export const conversionCreatedResponse = registry.register(
  'ConversionCreatedResponse',
  z
    .object({
      status: z.enum(['created', 'deduped']),
      conversion: conversionShape.nullable(),
    })
    .openapi('ConversionCreatedResponse'),
);

export const listConversionsQuery = z.object({
  contactId: z.string().uuid().optional(),
  limit: listLimit,
});

export const conversionsListResponse = registry.register(
  'ConversionsListResponse',
  z.object({ conversions: z.array(conversionShape) }).openapi('ConversionsListResponse'),
);

// ─── flows (list) ────────────────────────────────────────────────────────────
export const listFlowsQuery = z.object({ limit: listLimit });

const flowShape = z.object({
  id: z.string().uuid(),
  name: z.string(),
  triggerType: z.string(),
  status: z.string(),
  createdAt: z.string().datetime().nullable(),
});

export const flowsListResponse = registry.register(
  'FlowsListResponse',
  z.object({ flows: z.array(flowShape) }).openapi('FlowsListResponse'),
);

// ─── events (list + create) ──────────────────────────────────────────────────
export const listEventsQuery = z.object({
  from: z.string().datetime().optional().openapi({ description: 'ISO; filtra eventos com start >= from.' }),
  to: z.string().datetime().optional().openapi({ description: 'ISO; filtra eventos com start <= to.' }),
  limit: listLimit,
});

const eventShape = z.object({
  id: z.string().uuid(),
  calendarId: z.string().uuid(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  contactId: z.string().uuid().nullable(),
  createdAt: z.string().datetime().nullable(),
});

export const eventsListResponse = registry.register(
  'EventsListResponse',
  z.object({ events: z.array(eventShape) }).openapi('EventsListResponse'),
);

export const createEventBody = registry.register(
  'CreateEventRequest',
  z
    .object({
      calendarId: z.string().uuid().openapi({ description: 'Calendar de destino no workspace.' }),
      title: z.string().trim().min(1).max(300),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      type: z.enum(['meeting', 'demo', 'follow_up', 'task', 'reminder', 'other']).optional(),
      description: z.string().trim().max(MAX_TEXT_LEN).optional(),
      location: z.string().trim().max(500).optional(),
      contactId: z.string().uuid().optional(),
    })
    .openapi('CreateEventRequest'),
);

export const eventCreatedResponse = registry.register(
  'EventCreatedResponse',
  z.object({ event: eventShape }).openapi('EventCreatedResponse'),
);
